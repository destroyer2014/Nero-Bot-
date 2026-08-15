import fs from 'node:fs'
import path from 'node:path'

const file = path.resolve('data', 'premium-users.json')
const lockDir = path.resolve('data', 'movie-locks')

export const MOVIE_WAIT_MS = 24 * 60 * 60 * 1000
const MOVIE_LOCK_STALE_MS = 6 * 60 * 60 * 1000

function normalizeNumber(value = '') {
  return String(value || '')
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '')
}

function emptyState() {
  return {
    premium: {},
    movieUsage: {}
  }
}

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return {
      premium:
        parsed?.premium && typeof parsed.premium === 'object'
          ? parsed.premium
          : {},
      movieUsage:
        parsed?.movieUsage && typeof parsed.movieUsage === 'object'
          ? parsed.movieUsage
          : {}
    }
  } catch {
    return emptyState()
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`)
  fs.renameSync(temp, file)
}

export function premiumIdentity(value = '') {
  return normalizeNumber(value)
}

export function isPremium(value = '') {
  const id = normalizeNumber(value)
  if (!id) return false
  return Boolean(load().premium[id])
}

export function addPremium(value, { addedBy = '' } = {}) {
  const id = normalizeNumber(value)
  if (id.length < 8 || id.length > 18) {
    throw new Error('El número Premium no es válido.')
  }

  const data = load()
  const previous = data.premium[id]

  data.premium[id] = {
    number: id,
    addedAt: previous?.addedAt || Date.now(),
    updatedAt: Date.now(),
    addedBy: normalizeNumber(addedBy)
  }

  save(data)
  return data.premium[id]
}

export function removePremium(value = '') {
  const id = normalizeNumber(value)
  if (!id) return false

  const data = load()
  const existed = Boolean(data.premium[id])

  if (existed) {
    delete data.premium[id]
    save(data)
  }

  return existed
}

export function listPremium() {
  return Object.values(load().premium)
    .sort((a, b) => Number(a.addedAt || 0) - Number(b.addedAt || 0))
}

export function getMovieAccess(value, { isOwner = false } = {}) {
  const id = normalizeNumber(value)

  if (isOwner) {
    return {
      id,
      plan: 'owner',
      unlimited: true,
      lastSuccessAt: 0,
      nextAt: 0,
      remainingMs: 0
    }
  }

  if (isPremium(id)) {
    return {
      id,
      plan: 'premium',
      unlimited: true,
      lastSuccessAt: 0,
      nextAt: 0,
      remainingMs: 0
    }
  }

  const usage = load().movieUsage[id] || {}
  const lastSuccessAt = Number(usage.lastSuccessAt || 0)
  const nextAt = lastSuccessAt
    ? lastSuccessAt + MOVIE_WAIT_MS
    : 0

  return {
    id,
    plan: 'free',
    unlimited: false,
    lastSuccessAt,
    nextAt,
    remainingMs: Math.max(0, nextAt - Date.now()),
    lastTitle: usage.lastTitle || '',
    lastSlug: usage.lastSlug || ''
  }
}

export function markMovieSuccess(
  value,
  {
    title = '',
    slug = ''
  } = {}
) {
  const id = normalizeNumber(value)
  if (!id) return null

  const data = load()
  data.movieUsage[id] = {
    lastSuccessAt: Date.now(),
    lastTitle: String(title || ''),
    lastSlug: String(slug || '')
  }
  save(data)

  return data.movieUsage[id]
}

function lockFile(value) {
  const id = normalizeNumber(value)
  if (!id) return ''
  return path.join(lockDir, `${id}.lock`)
}

function readLock(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

export function acquireMovieLock(value = '') {
  const target = lockFile(value)
  if (!target) return { ok: false, reason: 'invalid' }

  fs.mkdirSync(lockDir, { recursive: true })

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(target, 'wx')
      try {
        fs.writeFileSync(
          fd,
          JSON.stringify({
            pid: process.pid,
            startedAt: Date.now()
          })
        )
      } finally {
        fs.closeSync(fd)
      }

      return { ok: true, file: target }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error

      const lock = readLock(target)
      const startedAt = Number(lock?.startedAt || 0)

      if (
        !startedAt ||
        Date.now() - startedAt > MOVIE_LOCK_STALE_MS
      ) {
        try {
          fs.rmSync(target, { force: true })
          continue
        } catch {}
      }

      return {
        ok: false,
        reason: 'busy',
        startedAt
      }
    }
  }

  return { ok: false, reason: 'busy' }
}

export function releaseMovieLock(value = '') {
  const target = lockFile(value)
  if (!target) return
  try {
    fs.rmSync(target, { force: true })
  } catch {}
}

export function formatMovieWait(ms = 0) {
  let seconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000))
  const days = Math.floor(seconds / 86400)
  seconds %= 86400
  const hours = Math.floor(seconds / 3600)
  seconds %= 3600
  const minutes = Math.floor(seconds / 60)

  return [
    days ? `${days} d` : '',
    hours ? `${hours} h` : '',
    minutes ? `${minutes} min` : '',
    !days && !hours && !minutes ? `${seconds} s` : ''
  ].filter(Boolean).join(' ')
}
