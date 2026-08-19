import fs from 'node:fs'
import path from 'node:path'

const HEARTBEAT_DIR = path.resolve('runtime', 'instance-heartbeats')
const HEARTBEAT_INTERVAL_MS = 4000
const DEFAULT_MAX_AGE_MS = 12000

function safe(value = '') {
  return String(value || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120)
}

function keyFor(instanceType = 'principal', instanceId = '') {
  return instanceType === 'subbot'
    ? `subbot-${safe(instanceId)}`
    : 'principal'
}

function fileFor(instanceType = 'principal', instanceId = '') {
  return path.join(
    HEARTBEAT_DIR,
    `${keyFor(instanceType, instanceId)}.json`
  )
}

function atomicWrite(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`)
  fs.renameSync(temp, file)
}

function writeState(instanceType, instanceId, online) {
  const file = fileFor(instanceType, instanceId)
  atomicWrite(file, {
    instanceType,
    instanceId:
      instanceType === 'subbot' ? String(instanceId || '') : 'principal',
    online: Boolean(online),
    pid: process.pid,
    updatedAt: Date.now()
  })
}

export function createInstanceHeartbeat(
  instanceType = 'principal',
  instanceId = ''
) {
  let online = false

  const timer = setInterval(() => {
    if (!online) return
    try {
      writeState(instanceType, instanceId, true)
    } catch (error) {
      console.warn('[INSTANCE HEARTBEAT]', error?.message || error)
    }
  }, HEARTBEAT_INTERVAL_MS)

  timer.unref?.()

  return {
    setOnline(value) {
      online = Boolean(value)
      try {
        writeState(instanceType, instanceId, online)
      } catch (error) {
        console.warn('[INSTANCE HEARTBEAT]', error?.message || error)
      }
    },

    stop() {
      online = false
      clearInterval(timer)
      try {
        writeState(instanceType, instanceId, false)
      } catch {}
    }
  }
}

export function getInstanceHeartbeat(
  instanceType = 'principal',
  instanceId = ''
) {
  try {
    return JSON.parse(
      fs.readFileSync(fileFor(instanceType, instanceId), 'utf8')
    )
  } catch {
    return null
  }
}

export function isInstanceAlive(
  instanceType = 'principal',
  instanceId = '',
  maxAgeMs = DEFAULT_MAX_AGE_MS
) {
  const heartbeat = getInstanceHeartbeat(instanceType, instanceId)
  if (!heartbeat?.online) return false

  const age = Date.now() - Number(heartbeat.updatedAt || 0)
  return age >= 0 && age <= maxAgeMs
}
