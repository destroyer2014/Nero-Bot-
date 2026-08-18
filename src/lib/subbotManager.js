import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn, spawnSync } from 'node:child_process'
import {
  listSubbots,
  getSubbot,
  upsertSubbot,
  removeSubbot
} from './subbotRegistry.js'

export const CODE_COOLDOWN_MS = 120000

const pending = new Map()
const childProcesses = new Map()
const restartTimers = new Map()
const expectedStops = new Set()

let shuttingDown = false
let restorePromise = null

function configuredManager() {
  return String(
    process.env.NERO_SUBBOT_PROCESS_MANAGER ||
    process.env.NERO_PROCESS_MANAGER ||
    'auto'
  ).trim().toLowerCase()
}

function detectPm2() {
  const forced = configuredManager()

  if (['child', 'panel', 'native'].includes(forced)) return false
  if (forced === 'pm2') return true

  try {
    const result = spawnSync('pm2', ['--version'], {
      stdio: 'ignore',
      timeout: 5000
    })
    return result.status === 0
  } catch {
    return false
  }
}

const USE_PM2 = detectPm2()

export function subbotProcessManagerMode() {
  return USE_PM2 ? 'pm2' : 'child'
}

function workerName(id) {
  return `nero-subbot-${id}`
}

function workerArgs(id, phone) {
  return [
    'src/subbot-worker.js',
    '--id',
    String(id),
    '--phone',
    String(phone || id)
  ]
}

function runPm2(args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('pm2', args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
      if (stdout.length > 12000) stdout = stdout.slice(-12000)
    })

    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
      if (stderr.length > 12000) stderr = stderr.slice(-12000)
    })

    child.once('error', error => {
      if (error.code === 'ENOENT') {
        reject(
          new Error(
            'PM2 no está instalado o no está disponible en PATH.'
          )
        )
      } else {
        reject(error)
      }
    })

    child.once('close', code => {
      const result = {
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      }

      if (code === 0 || allowFailure) {
        resolve(result)
        return
      }

      const detail =
        result.stderr ||
        result.stdout ||
        `PM2 terminó con código ${code}`

      reject(new Error(detail))
    })
  })
}

function clearRestartTimer(id) {
  const timer = restartTimers.get(String(id))
  if (timer) clearTimeout(timer)
  restartTimers.delete(String(id))
}

function activeChild(id) {
  const record = childProcesses.get(String(id))
  const child = record?.child

  if (!child) return null
  if (child.exitCode !== null || child.killed) return null

  return record
}

function shouldAutoRestart(id) {
  const bot = getSubbot(String(id))
  if (!bot) return false

  const status = String(bot.status || '').toLowerCase()

  if (
    [
      'pairing-paused',
      'failed',
      'error',
      'stopped',
      'deleted'
    ].includes(status)
  ) {
    return false
  }

  return true
}

function scheduleChildRestart(id, phone) {
  const key = String(id)

  if (shuttingDown || restartTimers.has(key)) return
  if (!shouldAutoRestart(key)) return

  const timer = setTimeout(() => {
    restartTimers.delete(key)

    if (shuttingDown || activeChild(key)) return
    if (!shouldAutoRestart(key)) return

    console.log(
      `[SUBBOT MANAGER] Reiniciando ${key} como proceso hijo.`
    )

    spawnChildWorker(key, phone || getSubbot(key)?.phone || key)
  }, 5000)

  timer.unref?.()
  restartTimers.set(key, timer)
}

function spawnChildWorker(id, phone) {
  const key = String(id)
  const existing = activeChild(key)

  if (existing) return existing

  clearRestartTimer(key)

  const child = spawn(
    process.execPath,
    workerArgs(key, phone),
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: false,
      env: {
        ...process.env,
        NERO_INSTANCE_PARENT: 'panel-child',
        NERO_SUBBOT_PROCESS_MANAGER: 'child'
      }
    }
  )

  const record = {
    id: key,
    name: workerName(key),
    phone: String(phone || key),
    child,
    startedAt: Date.now()
  }

  childProcesses.set(key, record)

  child.once('spawn', () => {
    console.log(
      `[SUBBOT MANAGER] ${workerName(key)} iniciado ` +
      `(PID ${child.pid}) en modo child.`
    )
  })

  child.once('error', error => {
    console.error(
      `[SUBBOT MANAGER] ${workerName(key)}:`,
      error?.message || error
    )
  })

  child.once('exit', (code, signal) => {
    childProcesses.delete(key)

    const expected = expectedStops.delete(key)

    console.log(
      `[SUBBOT MANAGER] ${workerName(key)} terminó ` +
      `(code=${code ?? 'null'}, signal=${signal || 'none'}).`
    )

    if (expected || shuttingDown) return

    scheduleChildRestart(
      key,
      getSubbot(key)?.phone || phone || key
    )
  })

  return record
}

async function stopChildWorker(id, {
  timeoutMs = 5000
} = {}) {
  const key = String(id)
  clearRestartTimer(key)

  const record = activeChild(key)
  if (!record) return

  expectedStops.add(key)

  const child = record.child

  await new Promise(resolve => {
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }

    child.once('exit', finish)

    const timer = setTimeout(() => {
      if (
        child.exitCode === null &&
        !child.killed
      ) {
        child.kill('SIGKILL')
      }
      finish()
    }, timeoutMs)

    child.kill('SIGTERM')
  })

  childProcesses.delete(key)
  expectedStops.delete(key)
}

async function sessionIsRegistered(id) {
  const creds = path.resolve(
    'sessions',
    'subbots',
    String(id),
    'creds.json'
  )

  try {
    const data = JSON.parse(await fs.readFile(creds, 'utf8'))
    return Boolean(data?.registered)
  } catch {
    return false
  }
}

async function discoverSessionIds() {
  const dir = path.resolve('sessions', 'subbots')

  try {
    const entries = await fs.readdir(dir, {
      withFileTypes: true
    })

    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
  } catch {
    return []
  }
}

async function ensureRegistryForSessions() {
  const existing = new Set(
    listSubbots().map(bot =>
      String(bot.id || bot.phone || '')
    ).filter(Boolean)
  )

  for (const id of await discoverSessionIds()) {
    if (existing.has(id)) continue
    if (!await sessionIsRegistered(id)) continue

    upsertSubbot({
      id,
      phone: id,
      status: 'connected',
      restoredFromSession: true,
      restoredAt: Date.now(),
      sessionDir: path.resolve(
        'sessions',
        'subbots',
        id
      )
    })
  }
}

async function pm2States() {
  const result = await runPm2(
    ['jlist'],
    { allowFailure: true }
  )

  let processes = []

  try {
    processes = JSON.parse(result.stdout || '[]')
  } catch {
    processes = []
  }

  return processes
    .filter(item =>
      String(item?.name || '')
        .startsWith('nero-subbot-')
    )
    .map(item => ({
      id: String(item.name)
        .replace(/^nero-subbot-/, ''),
      name: item.name,
      status: String(
        item?.pm2_env?.status || 'unknown'
      ).toLowerCase()
    }))
}

async function startPm2Worker(id, phone) {
  const name = workerName(id)

  await runPm2(
    ['delete', name],
    { allowFailure: true }
  )

  await runPm2([
    'start',
    'src/subbot-worker.js',
    '--name',
    name,
    '--stop-exit-codes',
    '0',
    '--',
    '--id',
    String(id),
    '--phone',
    String(phone || id)
  ])

  spawn('pm2', ['save'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    detached: true
  }).unref()

  return {
    name,
    sessionDir: path.resolve(
      'sessions',
      'subbots',
      String(id)
    )
  }
}

export function canRequestCode(user) {
  const lastRequest = pending.get(user) || 0

  return Math.max(
    0,
    CODE_COOLDOWN_MS -
    (Date.now() - lastRequest)
  )
}

export function markCodeRequest(user) {
  pending.set(user, Date.now())
}

export async function startSubbotProcess({
  id,
  phone,
  requestChat,
  requester,
  platform = 'Desconocido',
  deliveryInstanceType = 'principal',
  deliveryInstanceId = null
}) {
  const key = String(id)
  const sessionDir = path.resolve(
    'sessions',
    'subbots',
    key
  )
  const name = workerName(key)

  if (USE_PM2) {
    await runPm2(
      ['delete', name],
      { allowFailure: true }
    )
  } else {
    await stopChildWorker(key)
  }

  await fs.rm(
    sessionDir,
    { recursive: true, force: true }
  )
  await fs.mkdir(
    sessionDir,
    { recursive: true }
  )

  upsertSubbot({
    id: key,
    phone,
    requestChat,
    requester,
    platform,
    deliveryInstanceType,
    deliveryInstanceId,
    processManager: subbotProcessManagerMode(),
    status: 'starting',
    startedAt: Date.now(),
    sessionDir
  })

  try {
    if (USE_PM2) {
      await startPm2Worker(key, phone)
    } else {
      spawnChildWorker(key, phone)
    }
  } catch (error) {
    removeSubbot(key)
    await fs.rm(
      sessionDir,
      { recursive: true, force: true }
    )

    throw new Error(
      `No se pudo iniciar el subbot: ${error.message}`
    )
  }

  return {
    name,
    sessionDir,
    manager: subbotProcessManagerMode()
  }
}

export async function deleteSubbot(id) {
  const key = String(id)

  if (USE_PM2) {
    await runPm2(
      ['delete', workerName(key)],
      { allowFailure: true }
    )
  } else {
    await stopChildWorker(key)
  }

  await fs.rm(
    path.resolve('sessions', 'subbots', key),
    {
      recursive: true,
      force: true
    }
  )

  removeSubbot(key)

  if (USE_PM2) {
    spawn('pm2', ['save'], {
      stdio: 'ignore',
      detached: true
    }).unref()
  }
}

export async function listPm2SubbotStates() {
  if (USE_PM2) return pm2States()

  const ids = new Set([
    ...listSubbots()
      .map(bot => String(bot.id || bot.phone || ''))
      .filter(Boolean),
    ...childProcesses.keys()
  ])

  return [...ids].map(id => ({
    id,
    name: workerName(id),
    status: activeChild(id)
      ? 'online'
      : 'stopped'
  }))
}

export async function restoreRegisteredSubbots() {
  if (restorePromise) return restorePromise

  restorePromise = (async () => {
    await ensureRegistryForSessions()

    const bots = listSubbots()

    if (!bots.length) {
      console.log(
        `[SUBBOT MANAGER] modo=${subbotProcessManagerMode()} ` +
        '• no hay SubBots para restaurar.'
      )
      return {
        manager: subbotProcessManagerMode(),
        restored: [],
        skipped: []
      }
    }

    const restored = []
    const skipped = []

    if (USE_PM2) {
      const states = await pm2States()
      const online = new Set(
        states
          .filter(item => item.status === 'online')
          .map(item => item.id)
      )

      for (const bot of bots) {
        const id = String(bot.id || bot.phone || '')
        if (!id) continue

        if (!await sessionIsRegistered(id)) {
          skipped.push({
            id,
            reason: 'sesión no vinculada'
          })
          continue
        }

        if (online.has(id)) {
          restored.push({
            id,
            status: 'already-online'
          })
          continue
        }

        try {
          await startPm2Worker(
            id,
            bot.phone || id
          )

          restored.push({
            id,
            status: 'started'
          })
        } catch (error) {
          skipped.push({
            id,
            reason: error?.message || String(error)
          })
        }
      }
    } else {
      for (const bot of bots) {
        const id = String(bot.id || bot.phone || '')
        if (!id) continue

        if (!await sessionIsRegistered(id)) {
          skipped.push({
            id,
            reason: 'sesión no vinculada'
          })
          continue
        }

        if (activeChild(id)) {
          restored.push({
            id,
            status: 'already-online'
          })
          continue
        }

        spawnChildWorker(
          id,
          bot.phone || id
        )

        restored.push({
          id,
          status: 'started'
        })
      }
    }

    console.log(
      `[SUBBOT MANAGER] modo=${subbotProcessManagerMode()} ` +
      `• restaurados=${restored.length} ` +
      `• omitidos=${skipped.length}`
    )

    return {
      manager: subbotProcessManagerMode(),
      restored,
      skipped
    }
  })()

  try {
    return await restorePromise
  } finally {
    restorePromise = null
  }
}

export async function deleteBrokenSubbots() {
  const states = await listPm2SubbotStates()
  const stateMap = new Map(
    states.map(item => [item.id, item])
  )

  const badProcessStates = new Set([
    'errored',
    'stopped',
    'stopping'
  ])

  const badRegistryStates = new Set([
    'pairing-paused',
    'error',
    'failed',
    'stopped',
    'disconnected'
  ])

  const deleted = []
  const protectedItems = []

  for (const bot of listSubbots()) {
    const id = String(bot.id || bot.phone || '')
    if (!id) continue

    const processState = stateMap.get(id)
    const registryState = String(
      bot.status || ''
    ).toLowerCase()

    if (processState?.status === 'online') {
      protectedItems.push({
        id,
        status: 'online'
      })
      continue
    }

    if (
      registryState === 'connected' &&
      await sessionIsRegistered(id)
    ) {
      try {
        if (USE_PM2) {
          await startPm2Worker(
            id,
            bot.phone || id
          )
        } else {
          spawnChildWorker(
            id,
            bot.phone || id
          )
        }

        protectedItems.push({
          id,
          status: 'restored'
        })
        continue
      } catch {}
    }

    if (
      badRegistryStates.has(registryState) ||
      badProcessStates.has(
        processState?.status
      )
    ) {
      await deleteSubbot(id)
      deleted.push({
        id,
        status:
          processState?.status ||
          registryState ||
          'unknown'
      })
    }
  }

  return {
    deleted,
    protected: protectedItems,
    states
  }
}

export async function restartAllSubbots() {
  const bots = listSubbots()

  if (USE_PM2) {
    for (const bot of bots) {
      const id = String(bot.id || bot.phone || '')
      if (!id) continue

      const name = workerName(id)
      const result = await runPm2(
        ['restart', name],
        { allowFailure: true }
      )

      if (result.code !== 0) {
        if (await sessionIsRegistered(id)) {
          await startPm2Worker(
            id,
            bot.phone || id
          )
        }
      }
    }

    return
  }

  for (const bot of bots) {
    const id = String(bot.id || bot.phone || '')
    if (!id) continue
    if (!await sessionIsRegistered(id)) continue

    await stopChildWorker(id)
    spawnChildWorker(
      id,
      bot.phone || id
    )
  }
}

export async function shutdownSubbotProcesses() {
  if (USE_PM2) return

  shuttingDown = true

  for (const timer of restartTimers.values()) {
    clearTimeout(timer)
  }
  restartTimers.clear()

  const ids = [...childProcesses.keys()]

  await Promise.allSettled(
    ids.map(id =>
      stopChildWorker(
        id,
        { timeoutMs: 3500 }
      )
    )
  )
}

export function childSubbotCount() {
  return [...childProcesses.values()]
    .filter(record =>
      record?.child &&
      record.child.exitCode === null &&
      !record.child.killed
    )
    .length
}

console.log(
  `[SUBBOT MANAGER] Gestor seleccionado: ` +
  `${subbotProcessManagerMode()}`
)
