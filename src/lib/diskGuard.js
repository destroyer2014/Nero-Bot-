import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const MB = 1024 * 1024
const DEFAULT_RESERVE_MB = 1024
const DEFAULT_MAX_AGE_MINUTES = 360

export class DiskSpaceError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'DiskSpaceError'
    this.code = 'NERO_DISK_SPACE'
    this.details = details
  }
}

export function isDiskSpaceError(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || error || '')
  return (
    code === 'ENOSPC' ||
    code === 'EDQUOT' ||
    code === 'NERO_DISK_SPACE' ||
    /no space left on device|disk quota|quota exceeded|not enough space/i.test(
      message
    )
  )
}

export function diskSpaceUserMessage() {
  return [
    '⚠️ *Nero no tiene suficiente espacio temporal*',
    '',
    'No pude procesar este archivo sin poner en riesgo la sesión del bot.',
    'El espacio temporal será limpiado automáticamente.',
    '',
    '> Intenta nuevamente dentro de unos minutos.'
  ].join('\n')
}

export async function getNeroTempRoot() {
  const configured = String(
    process.env.NERO_TMP_DIR || 'tmp/runtime'
  ).trim()

  const root = path.resolve(configured || 'tmp/runtime')
  await fs.mkdir(root, { recursive: true })

  return root
}

async function projectUsageBytes() {
  const quotaMb = Number(process.env.NERO_DISK_QUOTA_MB || 0)
  if (!(quotaMb > 0)) return null

  try {
    const { stdout } = await execFileAsync(
      'du',
      ['-sk', process.cwd()],
      {
        timeout: 30_000,
        maxBuffer: 1024 * 1024
      }
    )

    const kb = Number(String(stdout).trim().split(/\s+/)[0])
    return Number.isFinite(kb) ? kb * 1024 : null
  } catch {
    return null
  }
}

export async function diskSnapshot() {
  const root = await getNeroTempRoot()

  let filesystemFree = Number.POSITIVE_INFINITY

  try {
    const stat = await fs.statfs(root)
    const blockSize = Number(stat.bsize || 0)
    const blocks = Number(stat.bavail ?? stat.bfree ?? 0)

    if (blockSize > 0 && blocks >= 0) {
      filesystemFree = blockSize * blocks
    }
  } catch {}

  const quotaMb = Number(process.env.NERO_DISK_QUOTA_MB || 0)
  const quotaBytes = quotaMb > 0 ? quotaMb * MB : null
  const usedBytes = quotaBytes ? await projectUsageBytes() : null
  const quotaFree =
    quotaBytes && Number.isFinite(usedBytes)
      ? Math.max(0, quotaBytes - usedBytes)
      : Number.POSITIVE_INFINITY

  return {
    root,
    filesystemFree,
    quotaBytes,
    usedBytes,
    availableBytes: Math.min(filesystemFree, quotaFree)
  }
}

export async function ensureDiskSpace(
  requiredBytes = 0,
  {
    reserveBytes = 0,
    label = 'esta operación'
  } = {}
) {
  const required = Math.max(0, Number(requiredBytes || 0))
  const configuredReserve =
    Number(process.env.NERO_DISK_RESERVE_MB || DEFAULT_RESERVE_MB) * MB
  const reserve = reserveBytes > 0
    ? Number(reserveBytes)
    : configuredReserve

  const snapshot = await diskSnapshot()
  const needed = required + Math.max(0, reserve)

  if (
    Number.isFinite(snapshot.availableBytes) &&
    snapshot.availableBytes < needed
  ) {
    throw new DiskSpaceError(
      `No hay espacio temporal suficiente para ${label}.`,
      {
        requiredBytes: required,
        reserveBytes: reserve,
        availableBytes: snapshot.availableBytes
      }
    )
  }

  return snapshot
}

async function removeEntry(entry) {
  await fs.rm(entry, {
    recursive: true,
    force: true
  }).catch(() => {})
}

export async function cleanupNeroTemp({
  aggressive = false,
  maxAgeMinutes = Number(
    process.env.NERO_TMP_MAX_AGE_MINUTES ||
    DEFAULT_MAX_AGE_MINUTES
  )
} = {}) {
  const root = await getNeroTempRoot()

  let entries = []
  try {
    entries = await fs.readdir(root, {
      withFileTypes: true
    })
  } catch {
    return { removed: 0, root }
  }

  const cutoff =
    Date.now() -
    Math.max(5, Number(maxAgeMinutes || DEFAULT_MAX_AGE_MINUTES)) *
    60_000

  let removed = 0

  for (const entry of entries) {
    const target = path.join(root, entry.name)

    if (!aggressive) {
      try {
        const stat = await fs.stat(target)
        if (stat.mtimeMs >= cutoff) continue
      } catch {
        continue
      }
    }

    await removeEntry(target)
    removed += 1
  }

  return { removed, root }
}

export async function recoverDiskSpace({
  aggressive = false
} = {}) {
  return cleanupNeroTemp({
    aggressive,
    maxAgeMinutes: aggressive ? 5 : undefined
  })
}

let cleanupTimer = null

export async function initializeTempStorage({
  aggressive = false
} = {}) {
  const root = await getNeroTempRoot()

  // Así os.tmpdir(), Sharp/Libvips y helpers externos usan el
  // almacenamiento asignado al bot en vez del /tmp limitado del contenedor.
  process.env.TMPDIR = root
  process.env.TMP = root
  process.env.TEMP = root

  const cleaned = await cleanupNeroTemp({
    aggressive
  }).catch(() => ({ removed: 0, root }))

  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => {
      cleanupNeroTemp().catch(() => {})
    }, 30 * 60_000)

    cleanupTimer.unref?.()
  }

  console.log(
    `[TEMP] ${root} • limpieza inicial: ${cleaned.removed || 0}`
  )

  return root
}

export const diskGuardConfig = {
  reserveMb: Number(
    process.env.NERO_DISK_RESERVE_MB || DEFAULT_RESERVE_MB
  ),
  quotaMb: Number(process.env.NERO_DISK_QUOTA_MB || 0),
  maxAgeMinutes: Number(
    process.env.NERO_TMP_MAX_AGE_MINUTES ||
    DEFAULT_MAX_AGE_MINUTES
  )
}
