import fs from 'node:fs/promises'
import path from 'node:path'

const LOG_DIR = path.resolve('runtime', 'logs')
const MAX_LOG_BYTES = Math.max(
  256 * 1024,
  Number(process.env.NERO_LOG_MAX_MB || 2) * 1024 * 1024
)

function secretValues() {
  return [
    process.env.DVYER_API_KEY,
    process.env.EVOGB_API_KEY,
    process.env.APISPERU_TOKEN
  ].filter(Boolean)
}

function redactText(value = '') {
  let text = String(value || '')

  text = text
    .replace(
      /([?&](?:apikey|key|token|access_token)=)[^&\s]+/gi,
      '$1[REDACTED]'
    )
    .replace(
      /(authorization:\s*(?:bearer\s+)?)\S+/gi,
      '$1[REDACTED]'
    )

  for (const secret of secretValues()) {
    text = text.split(String(secret)).join('[REDACTED]')
  }

  return text.slice(0, 20_000)
}

function sanitize(value, depth = 0) {
  if (depth > 5) return '[MAX_DEPTH]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactText(value)

  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      code: value.code,
      status: value.status,
      message: redactText(value.message),
      stack: redactText(value.stack || '')
    }
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map(item =>
      sanitize(item, depth + 1)
    )
  }

  if (typeof value === 'object') {
    const out = {}

    for (const [key, item] of Object.entries(value).slice(0, 80)) {
      if (/pass(word)?|secret|apikey|token/i.test(key)) {
        out[key] = '[REDACTED]'
      } else {
        out[key] = sanitize(item, depth + 1)
      }
    }

    return out
  }

  return redactText(value)
}

async function rotateIfNeeded(file) {
  try {
    const stat = await fs.stat(file)
    if (stat.size < MAX_LOG_BYTES) return

    const rotated = `${file}.1`
    await fs.rm(rotated, { force: true }).catch(() => {})
    await fs.rename(file, rotated)
  } catch {}
}

export async function logRuntimeEvent(
  channel,
  event = {}
) {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true })

    const safeChannel = String(channel || 'runtime')
      .replace(/[^a-z0-9_-]+/gi, '-')
      .slice(0, 40)

    const file = path.join(LOG_DIR, `${safeChannel}.jsonl`)
    await rotateIfNeeded(file)

    const line = JSON.stringify(
      sanitize({
        at: new Date().toISOString(),
        pid: process.pid,
        node: process.version,
        ...event
      })
    )

    await fs.appendFile(file, `${line}\n`, 'utf8')
    return true
  } catch {
    // El log jamás debe tumbar a Nero, especialmente ante ENOSPC.
    return false
  }
}

export function logConnectionEvent(event = {}) {
  return logRuntimeEvent('connection', event)
}
