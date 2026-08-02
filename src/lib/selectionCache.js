import crypto from 'node:crypto'

const selections = new Map()
const TTL = 10 * 60 * 1000

export function saveSelection(type, data) {
  const token = crypto.randomBytes(4).toString('hex')
  selections.set(token, { type, data, expiresAt: Date.now() + TTL })
  return token
}

export function getSelection(token, expectedType) {
  const entry = selections.get(token)
  if (!entry || entry.expiresAt < Date.now() || (expectedType && entry.type !== expectedType)) {
    selections.delete(token)
    return null
  }
  return entry.data
}

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of selections) if (entry.expiresAt < now) selections.delete(key)
}, 60_000).unref()
