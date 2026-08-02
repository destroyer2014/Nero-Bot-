import { jidToNumber } from './format.js'

const queues = {
  heavy: { label: 'pesada', running: null, waiting: [] },
  light: { label: 'ligera', running: null, waiting: [] }
}

async function chatLabel(sock, chat) {
  if (!chat?.endsWith('@g.us')) return 'Chat privado'
  try {
    const metadata = await sock.groupMetadata(chat)
    return metadata?.subject || chat
  } catch {
    return chat
  }
}

function jobSummary(job) {
  if (!job) return 'Ninguna'
  return [
    `Comando: ${job.command}`,
    `Usuario: ${jidToNumber(job.sender)}`,
    `Grupo: ${job.group}`
  ].join('\n')
}

async function startNext(type) {
  const queue = queues[type]
  if (queue.running || !queue.waiting.length) return
  const job = queue.waiting.shift()
  queue.running = job

  if (job.wasQueued) {
    await job.sock.sendMessage(job.chat, {
      text: `✅ *Tu descarga ${queue.label} comenzará ahora.*\n${jobSummary(job)}`
    }, { quoted: job.msg }).catch(() => {})
  }

  try {
    await job.task()
    job.resolve()
  } catch (error) {
    job.reject(error)
  } finally {
    queue.running = null
    setImmediate(() => startNext(type))
  }
}

export async function runDownloadJob(ctx, type, command, task) {
  const queue = queues[type]
  if (!queue) throw new Error(`Tipo de cola inválido: ${type}`)

  const group = await chatLabel(ctx.sock, ctx.chat)
  const current = queue.running
  const wasQueued = Boolean(current)

  return new Promise(async (resolve, reject) => {
    const job = {
      sock: ctx.sock,
      msg: ctx.msg,
      chat: ctx.chat,
      sender: ctx.sender,
      command,
      group,
      task,
      resolve,
      reject,
      wasQueued
    }

    if (wasQueued) {
      queue.waiting.push(job)
      const position = queue.waiting.length
      await ctx.sock.sendMessage(ctx.chat, {
        text: [
          '⏳ *Por favor espera, ya hay otra descarga en curso.*',
          '',
          jobSummary(current),
          `Tu posición: ${position}`,
          `Cola: ${queue.label}`
        ].join('\n')
      }, { quoted: ctx.msg }).catch(() => {})
      return
    }

    queue.waiting.push(job)
    startNext(type)
  })
}

export function getQueueStatus() {
  return Object.entries(queues).map(([type, queue]) => ({
    type,
    label: queue.label,
    running: queue.running,
    waiting: queue.waiting.length
  }))
}

export function cancelUserJobs(sender) {
  let removed = 0
  for (const queue of Object.values(queues)) {
    const before = queue.waiting.length
    queue.waiting = queue.waiting.filter(job => job.sender !== sender)
    removed += before - queue.waiting.length
  }
  return removed
}

export function clearWaitingQueues() {
  let removed = 0
  for (const queue of Object.values(queues)) {
    removed += queue.waiting.length
    const jobs = queue.waiting.splice(0)
    for (const job of jobs) job.reject(new Error('La cola fue limpiada por el owner.'))
  }
  return removed
}

export function formatQueueStatus() {
  return getQueueStatus().map(queue => [
    `*Cola ${queue.label}:*`,
    queue.running ? jobSummary(queue.running) : 'Sin descarga activa',
    `En espera: ${queue.waiting}`
  ].join('\n')).join('\n\n')
}
