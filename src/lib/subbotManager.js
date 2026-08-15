import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { listSubbots, upsertSubbot, removeSubbot } from './subbotRegistry.js'

export const CODE_COOLDOWN_MS = 120000
const pending = new Map()

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
        reject(new Error('PM2 no está instalado o no está disponible en PATH.'))
      } else {
        reject(error)
      }
    })

    child.once('close', code => {
      const result = { code, stdout: stdout.trim(), stderr: stderr.trim() }
      if (code === 0 || allowFailure) {
        resolve(result)
        return
      }

      const detail = result.stderr || result.stdout || `PM2 terminó con código ${code}`
      reject(new Error(detail))
    })
  })
}

export function canRequestCode(user) {
  const lastRequest = pending.get(user) || 0
  return Math.max(0, CODE_COOLDOWN_MS - (Date.now() - lastRequest))
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
  const sessionDir = path.resolve('sessions', 'subbots', id)
  const name = `nero-subbot-${id}`

  // Elimina procesos e información incompleta de intentos anteriores.
  await runPm2(['delete', name], { allowFailure: true })
  await fs.rm(sessionDir, { recursive: true, force: true })
  await fs.mkdir(sessionDir, { recursive: true })

  upsertSubbot({
    id,
    phone,
    requestChat,
    requester,
    platform,
    deliveryInstanceType,
    deliveryInstanceId,
    status: 'starting',
    startedAt: Date.now(),
    sessionDir
  })

  try {
    await runPm2([
      'start',
      'src/subbot-worker.js',
      '--name',
      name,
      '--stop-exit-codes',
      '0',
      '--',
      '--id',
      id,
      '--phone',
      phone
    ])
  } catch (error) {
    removeSubbot(id)
    await fs.rm(sessionDir, { recursive: true, force: true })
    throw new Error(`No se pudo iniciar el subbot: ${error.message}`)
  }

  spawn('pm2', ['save'], {
    cwd: process.cwd(),
    stdio: 'ignore',
    detached: true
  }).unref()

  return { name, sessionDir }
}

export async function deleteSubbot(id) {
  await runPm2(['delete', `nero-subbot-${id}`], { allowFailure: true })
  await fs.rm(path.resolve('sessions', 'subbots', id), {
    recursive: true,
    force: true
  })
  removeSubbot(id)

  spawn('pm2', ['save'], {
    stdio: 'ignore',
    detached: true
  }).unref()
}

export async function listPm2SubbotStates() {
  const result = await runPm2(['jlist'], { allowFailure: true })
  let processes = []
  try {
    processes = JSON.parse(result.stdout || '[]')
  } catch {
    processes = []
  }

  return processes
    .filter(process => String(process?.name || '').startsWith('nero-subbot-'))
    .map(process => ({
      id: String(process.name).replace(/^nero-subbot-/, ''),
      name: process.name,
      status: String(process?.pm2_env?.status || 'unknown').toLowerCase()
    }))
}

export async function deleteBrokenSubbots() {
  const states = await listPm2SubbotStates()
  const stateMap = new Map(states.map(item => [item.id, item]))
  const badPm2 = new Set(['errored', 'stopped', 'stopping'])
  const badRegistry = new Set([
    'pairing-paused',
    'error',
    'failed',
    'stopped',
    'disconnected'
  ])

  const candidates = new Map()

  for (const item of states) {
    if (badPm2.has(item.status)) {
      candidates.set(item.id, item.status)
    }
  }

  for (const bot of listSubbots()) {
    const id = String(bot.id || bot.phone || '')
    if (!id) continue
    const pm2 = stateMap.get(id)

    // Protección absoluta: nunca borrar un proceso que PM2 reporte online.
    if (pm2?.status === 'online') continue

    const status = String(bot.status || '').toLowerCase()
    if (badRegistry.has(status)) {
      candidates.set(id, pm2?.status || status)
    }
  }

  const deleted = []
  const protectedItems = []

  for (const [id, status] of candidates) {
    const current = stateMap.get(id)
    if (current?.status === 'online') {
      protectedItems.push({ id, status: current.status })
      continue
    }

    await deleteSubbot(id)
    deleted.push({ id, status })
  }

  return { deleted, protected: protectedItems, states }
}

export async function restartAllSubbots() {
  for (const bot of listSubbots()) {
    spawn('pm2', ['restart', `nero-subbot-${bot.id}`], {
      stdio: 'ignore',
      detached: true
    }).unref()
  }
}
