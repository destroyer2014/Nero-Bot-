import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const root = path.resolve('runtime', 'sales')
const groupsDir = path.join(root, 'groups')
const mediaDir = path.join(root, 'media')

fs.mkdirSync(groupsDir, { recursive: true })
fs.mkdirSync(mediaDir, { recursive: true })

const sleepSync = ms => {
  const sab = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(sab), 0, 0, ms)
}

function keyForChat(chat = '') {
  return crypto
    .createHash('sha1')
    .update(String(chat))
    .digest('hex')
    .slice(0, 20)
}

function fileForChat(chat) {
  return path.join(groupsDir, `${keyForChat(chat)}.json`)
}

function lockForChat(chat) {
  return `${fileForChat(chat)}.lock`
}

function baseGroup(chat) {
  const now = Date.now()
  return {
    version: 1,
    chat,
    config: {
      enabled: true,
      businessName: 'Mi negocio',
      currency: 'PEN',
      description: '',
      address: '',
      phone: '',
      hours: '',
      assignMode: 'roundrobin',
      notifyMode: 'group',
      roundRobinIndex: 0
    },
    sellers: [],
    products: {},
    customers: {},
    leads: {},
    orders: {},
    followups: {},
    counters: {
      product: 0,
      lead: 0,
      order: 0,
      followup: 0
    },
    createdAt: now,
    updatedAt: now
  }
}

function normalizeGroup(group, chat) {
  const base = baseGroup(chat)
  const value = group && typeof group === 'object' ? group : {}
  value.version ||= 1
  value.chat ||= chat
  value.config = { ...base.config, ...(value.config || {}) }
  value.sellers = Array.isArray(value.sellers) ? value.sellers : []
  value.products ||= {}
  value.customers ||= {}
  value.leads ||= {}
  value.orders ||= {}
  value.followups ||= {}
  value.counters = { ...base.counters, ...(value.counters || {}) }
  value.createdAt ||= Date.now()
  value.updatedAt ||= Date.now()
  return value
}

function readUnlocked(chat) {
  const file = fileForChat(chat)
  try {
    return normalizeGroup(
      JSON.parse(fs.readFileSync(file, 'utf8')),
      chat
    )
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[SALES STORE READ]', error?.message || error)
    }
    return baseGroup(chat)
  }
}

function writeUnlocked(chat, group) {
  const file = fileForChat(chat)
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  group.updatedAt = Date.now()
  fs.writeFileSync(temp, JSON.stringify(group, null, 2))
  fs.renameSync(temp, file)
}

function acquireLock(chat) {
  const lock = lockForChat(chat)

  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const fd = fs.openSync(lock, 'wx')
      fs.writeFileSync(
        fd,
        JSON.stringify({ pid: process.pid, at: Date.now() })
      )
      return { lock, fd }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error

      try {
        const stat = fs.statSync(lock)
        if (Date.now() - stat.mtimeMs > 15000) {
          fs.rmSync(lock, { force: true })
          continue
        }
      } catch {}

      sleepSync(20)
    }
  }

  throw new Error('El almacenamiento de Ventas está ocupado. Intenta de nuevo.')
}

function releaseLock(handle) {
  try { fs.closeSync(handle.fd) } catch {}
  try { fs.rmSync(handle.lock, { force: true }) } catch {}
}

export function getSalesGroup(chat) {
  return readUnlocked(chat)
}

export function withSalesGroup(chat, mutator) {
  const handle = acquireLock(chat)

  try {
    const group = readUnlocked(chat)
    const result = mutator(group)
    writeUnlocked(chat, group)
    return result
  } finally {
    releaseLock(handle)
  }
}

export function salesMediaDir(chat, productId = '') {
  const base = path.join(mediaDir, keyForChat(chat))
  const target = productId
    ? path.join(base, String(productId).replace(/[^a-zA-Z0-9_-]/g, '_'))
    : base
  fs.mkdirSync(target, { recursive: true })
  return target
}

export function nextSalesId(group, type) {
  const config = {
    product: ['P', 4],
    lead: ['L', 5],
    order: ['O', 5],
    followup: ['F', 5]
  }[type]

  if (!config) throw new Error(`Tipo de ID inválido: ${type}`)

  group.counters[type] = Number(group.counters[type] || 0) + 1
  const [prefix, width] = config
  return `${prefix}-${String(group.counters[type]).padStart(width, '0')}`
}

export function salesStorePath(chat) {
  return fileForChat(chat)
}
