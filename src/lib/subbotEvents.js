import fs from 'node:fs/promises'
import path from 'node:path'

const dir = path.resolve('runtime', 'subbot-events')
const failedDir = path.resolve('runtime', 'subbot-events-failed')
const MAX_ATTEMPTS = 3
const STALE_PROCESSING_MS = 2 * 60 * 1000

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function defaultDedupeKey(event = {}) {
  const id = event.id || event.phone || 'unknown'

  if (event.type === 'pairing-code') {
    return `pairing-code:${id}:${event.code || ''}`
  }

  if (event.type === 'connected') {
    return `connected:${id}`
  }

  if (event.type === 'deleted') {
    return `deleted:${id}:${event.reason || ''}`
  }

  if (event.type === 'pairing-paused') {
    return `pairing-paused:${id}:${event.statusCode || 'unknown'}`
  }

  return `${event.type || 'event'}:${id}:${event.eventId || ''}`
}

export async function emitSubbotEvent(event = {}) {
  await fs.mkdir(dir, { recursive: true })

  const eventId = event.eventId || makeId()
  const payload = {
    ...event,
    eventId,
    dedupeKey: event.dedupeKey || defaultDedupeKey(event),
    createdAt: Number(event.createdAt || Date.now()),
    attempts: Number(event.attempts || 0)
  }

  const tmp = path.join(dir, `.${eventId}.tmp`)
  const file = path.join(dir, `${eventId}.json`)

  await fs.writeFile(tmp, JSON.stringify(payload), 'utf8')
  await fs.rename(tmp, file)

  return eventId
}

async function recoverStaleProcessing() {
  await fs.mkdir(dir, { recursive: true })

  const names = await fs.readdir(dir).catch(() => [])

  for (const name of names) {
    if (!name.endsWith('.processing')) continue

    const file = path.join(dir, name)

    try {
      const stat = await fs.stat(file)
      if (Date.now() - stat.mtimeMs < STALE_PROCESSING_MS) continue

      const retry = path.join(
        dir,
        name.replace(/\.processing$/, '.json')
      )

      await fs.rename(file, retry)
    } catch (error) {
      if (!['ENOENT', 'EEXIST'].includes(error?.code)) {
        console.warn(
          '[SUBBOT EVENT RECOVERY]',
          error?.message || error
        )
      }
    }
  }
}

async function moveToFailed(processingFile, event, error) {
  await fs.mkdir(failedDir, { recursive: true })

  const failed = {
    ...event,
    failedAt: Date.now(),
    lastError: String(error?.message || error || 'unknown')
  }

  const name = path.basename(processingFile)
    .replace(/\.processing$/, '.failed.json')

  await fs.writeFile(
    path.join(failedDir, name),
    JSON.stringify(failed, null, 2),
    'utf8'
  )

  await fs.rm(processingFile, { force: true })
}

export async function consumeSubbotEvents(handler) {
  await fs.mkdir(dir, { recursive: true })
  await recoverStaleProcessing()

  const names = (await fs.readdir(dir))
    .filter(name => name.endsWith('.json'))
    .sort()

  for (const name of names) {
    const file = path.join(dir, name)
    const processingFile = path.join(
      dir,
      name.replace(/\.json$/, '.processing')
    )

    try {
      await fs.rename(file, processingFile)
    } catch (error) {
      if (['ENOENT', 'EEXIST'].includes(error?.code)) continue
      throw error
    }

    let event

    try {
      event = JSON.parse(
        await fs.readFile(processingFile, 'utf8')
      )

      const nextAttemptAt = Number(event.nextAttemptAt || 0)

      if (nextAttemptAt > Date.now()) {
        await fs.rename(processingFile, file)
        continue
      }

      await handler(event)
      await fs.rm(processingFile, { force: true })
    } catch (error) {
      console.error(
        '[SUBBOT EVENT]',
        error?.message || error
      )

      const attempts = Number(event?.attempts || 0) + 1

      if (!event || attempts >= MAX_ATTEMPTS) {
        await moveToFailed(
          processingFile,
          event || { eventId: name },
          error
        ).catch(() => {})
        continue
      }

      event.attempts = attempts
      event.nextAttemptAt = Date.now() + attempts * 3000
      event.lastError = String(error?.message || error)

      try {
        await fs.writeFile(
          processingFile,
          JSON.stringify(event),
          'utf8'
        )
        await fs.rename(processingFile, file)
      } catch (requeueError) {
        console.error(
          '[SUBBOT EVENT REQUEUE]',
          requeueError?.message || requeueError
        )
      }
    }
  }
}
