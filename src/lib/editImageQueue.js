const queue = []
const activeUsers = new Set()
const cooldowns = new Map()
let processing = false

const COOLDOWN_MS = 10 * 60 * 1000

function formatLeft(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes} min ${seconds} s`
}

async function drain() {
  if (processing) return
  processing = true
  while (queue.length) {
    const item = queue.shift()
    if (item.cancelled) {
      activeUsers.delete(item.userId)
      item.reject(new Error('Solicitud cancelada.'))
      continue
    }
    item.started = true
    try {
      await item.onStart?.()
      const result = await item.run()
      cooldowns.set(item.userId, Date.now() + COOLDOWN_MS)
      item.resolve(result)
    } catch (error) {
      item.reject(error)
    } finally {
      activeUsers.delete(item.userId)
    }
  }
  processing = false
}

export function enqueueEdit({ userId, run, onStart }) {
  const until = cooldowns.get(userId) || 0
  const left = until - Date.now()
  if (left > 0) {
    throw new Error(`Debes esperar ${formatLeft(left)} para volver a editar una imagen.`)
  }
  if (activeUsers.has(userId)) {
    throw new Error('Ya tienes una edición en proceso o esperando en la cola.')
  }

  activeUsers.add(userId)
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  const item = {
    userId,
    run,
    onStart,
    started: false,
    cancelled: false,
    resolve: resolvePromise,
    reject: rejectPromise
  }
  queue.push(item)
  const position = queue.length + (processing ? 1 : 0)
  queueMicrotask(drain)
  return { promise, position }
}

export function getEditQueueStatus(userId) {
  const waitingIndex = queue.findIndex(item => item.userId === userId && !item.cancelled)
  const until = cooldowns.get(userId) || 0
  return {
    processing,
    waiting: queue.filter(item => !item.cancelled).length,
    position: waitingIndex >= 0 ? waitingIndex + 1 + (processing ? 1 : 0) : null,
    active: activeUsers.has(userId),
    cooldownMs: Math.max(0, until - Date.now())
  }
}

export function cancelEdit(userId) {
  const item = queue.find(entry => entry.userId === userId && !entry.started && !entry.cancelled)
  if (!item) return false
  item.cancelled = true
  activeUsers.delete(userId)
  return true
}

export { formatLeft }
