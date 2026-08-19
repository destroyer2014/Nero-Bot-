const USER_COOLDOWN_MS = Math.max(
  500,
  Number(process.env.NERO_USER_COMMAND_COOLDOWN_MS || 2000)
)

const CHAT_WINDOW_MS = Math.max(
  5000,
  Number(process.env.NERO_CHAT_COMMAND_WINDOW_MS || 20000)
)

const CHAT_MAX_COMMANDS = Math.max(
  2,
  Number(process.env.NERO_CHAT_MAX_COMMANDS || 8)
)

const WARNING_SILENCE_MS = Math.max(
  5000,
  Number(process.env.NERO_RATE_WARNING_SILENCE_MS || 8000)
)

const DUPLICATE_TTL_MS = 60000

const users = new Map()
const chats = new Map()
const warnings = new Map()
const messageIds = new Map()

function pruneMessageIds(now) {
  for (const [key, at] of messageIds) {
    if (now - at > DUPLICATE_TTL_MS) messageIds.delete(key)
  }
}

function canNotify(key, now) {
  const last = warnings.get(key) || 0
  if (now - last < WARNING_SILENCE_MS) return false
  warnings.set(key, now)
  return true
}

function recentChatCommands(chat, now) {
  const values = (chats.get(chat) || [])
    .filter(at => now - at < CHAT_WINDOW_MS)

  chats.set(chat, values)
  return values
}

export function checkCommandRate({
  sender = '',
  chat = '',
  messageId = ''
} = {}) {
  const now = Date.now()
  const normalizedSender = String(sender || '')
  const normalizedChat = String(chat || '')
  const duplicateKey = `${normalizedChat}:${String(messageId || '')}`

  if (messageId) {
    pruneMessageIds(now)

    if (messageIds.has(duplicateKey)) {
      return {
        allow: false,
        duplicate: true,
        notify: false,
        waitMs: 0,
        reason: 'duplicate'
      }
    }

    messageIds.set(duplicateKey, now)
  }

  const userKey = `${normalizedChat}:${normalizedSender}`
  const previous = users.get(userKey) || 0
  const elapsed = now - previous

  if (previous && elapsed < USER_COOLDOWN_MS) {
    return {
      allow: false,
      duplicate: false,
      notify: canNotify(`user:${userKey}`, now),
      waitMs: USER_COOLDOWN_MS - elapsed,
      reason: 'user-cooldown'
    }
  }

  const recent = recentChatCommands(normalizedChat, now)

  if (recent.length >= CHAT_MAX_COMMANDS) {
    const waitMs = Math.max(
      1000,
      CHAT_WINDOW_MS - (now - recent[0])
    )

    return {
      allow: false,
      duplicate: false,
      notify: canNotify(`chat:${normalizedChat}`, now),
      waitMs,
      reason: 'chat-burst'
    }
  }

  users.set(userKey, now)
  recent.push(now)
  chats.set(normalizedChat, recent)

  return {
    allow: true,
    duplicate: false,
    notify: false,
    waitMs: 0,
    reason: 'ok'
  }
}

export function rateLimitMessage(result = {}) {
  const seconds = Math.max(
    1,
    Math.ceil(Number(result.waitMs || USER_COOLDOWN_MS) / 1000)
  )

  const detail = result.reason === 'chat-burst'
    ? 'Hay demasiados comandos ejecutándose en este chat.'
    : 'Estás enviando comandos demasiado rápido.'

  return [
    '「⏳」 *Espera un momento*',
    '',
    detail,
    `Intenta nuevamente en ${seconds} segundo${seconds === 1 ? '' : 's'}.`,
    '',
    '> Nero AI | © ArcadiaCorps'
  ].join('\n')
}

export const commandRateConfig = {
  userCooldownMs: USER_COOLDOWN_MS,
  chatWindowMs: CHAT_WINDOW_MS,
  chatMaxCommands: CHAT_MAX_COMMANDS,
  warningSilenceMs: WARNING_SILENCE_MS
}
