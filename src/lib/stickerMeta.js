import fs from 'node:fs'
import path from 'node:path'

const file = path.resolve('data', 'sticker-meta.json')
const defaults = { packname: 'Nero Bot', author: 'ArcadiaCorps', users: {} }

function idFromJid(jid = '') {
  return String(jid || '')
    .replace(/:\d+@/g, '@')
    .split('@')[0]
    .replace(/\D/g, '') || 'unknown'
}

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return {
      packname: parsed?.packname || defaults.packname,
      author: parsed?.author || defaults.author,
      users: parsed?.users && typeof parsed.users === 'object' ? parsed.users : {}
    }
  } catch {
    return { ...defaults, users: {} }
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

export function getStickerMeta(jid = '') {
  const data = load()
  const base = { packname: data.packname, author: data.author }
  if (!jid) return base
  const custom = data.users[idFromJid(jid)]
  return custom ? { ...base, ...custom } : base
}

export function setStickerMeta(patch = {}, jid = '') {
  const data = load()
  if (jid) {
    const id = idFromJid(jid)
    data.users[id] = {
      ...(data.users[id] || {}),
      ...patch,
      updatedAt: Date.now()
    }
    save(data)
    return getStickerMeta(jid)
  }

  const next = {
    ...data,
    ...patch,
    users: data.users
  }
  save(next)
  return { packname: next.packname, author: next.author }
}

export function delStickerMeta(jid = '') {
  if (!jid) return false
  const data = load()
  const id = idFromJid(jid)
  if (!data.users[id]) return false
  delete data.users[id]
  save(data)
  return true
}
