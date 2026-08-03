import crypto from 'node:crypto'
const recent = new Map()
const TTL = 30 * 60 * 1000
export function rememberError({ sender, chat, command, error, instanceType='principal' }) {
  const code = `NERO-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
  recent.set(sender, { code, chat, command, message: error?.message || String(error), stack: error?.stack || '', instanceType, createdAt: Date.now() })
  return code
}
export function getRecentError(sender) {
  const item = recent.get(sender)
  if (!item || Date.now() - item.createdAt > TTL) { recent.delete(sender); return null }
  return item
}
