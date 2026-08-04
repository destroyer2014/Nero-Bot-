const pending = new Map()
const TTL_MS = 2 * 60 * 1000
const key = (chat, sender) => `${chat}|${sender}`
export function setPendingSubbotPhone(chat, sender) { pending.set(key(chat, sender), Date.now() + TTL_MS) }
export function hasPendingSubbotPhone(chat, sender) { const k=key(chat,sender); const until=pending.get(k)||0; if(until<Date.now()){pending.delete(k);return false} return true }
export function clearPendingSubbotPhone(chat, sender) { pending.delete(key(chat,sender)) }
