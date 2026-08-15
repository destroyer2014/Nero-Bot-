import fs from 'node:fs'
import path from 'node:path'

const file = path.resolve('data', 'instance-modes.json')
const DEFAULT_MODE = 'all'

function ensureDir() {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function save(data) {
  ensureDir()
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

export function normalizeInstanceKey(instanceType = 'principal', instanceId = '') {
  return instanceType === 'subbot' && instanceId
    ? `subbot:${String(instanceId)}`
    : 'principal'
}

export function getInstanceMode(instanceType = 'principal', instanceId = '') {
  const key = normalizeInstanceKey(instanceType, instanceId)
  const value = load()[key]
  return value === 'groups' ? 'groups' : DEFAULT_MODE
}

export function setInstanceMode(instanceType = 'principal', instanceId = '', mode = DEFAULT_MODE) {
  const normalized = mode === 'groups' ? 'groups' : DEFAULT_MODE
  const key = normalizeInstanceKey(instanceType, instanceId)
  const data = load()
  data[key] = normalized
  save(data)
  return normalized
}

export function privateCommandsAllowed(commandName = '') {
  return new Set(['modo', 'modepick', 'code', 'jadibot', 'reportar', 'report', 'menu', 'help', 'comandos', 'ping', 'premium', 'addpremium', 'delpremium', 'premiumlist']).has(
    String(commandName).toLowerCase()
  )
}
