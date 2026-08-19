import { exec as execCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { downloadMediaMessage } from '@itsliaaa/baileys'
import { unwrapMessage } from '../lib/text.js'

const exec = promisify(execCallback)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

function quotedContext(msg) {
  const m = unwrapMessage(msg.message || {})
  return m.extendedTextMessage?.contextInfo || m.imageMessage?.contextInfo || m.videoMessage?.contextInfo
}

function ownerOnly(ctx) {
  if (!ctx.isOwner) throw new Error('Este comando es exclusivo para owners.')
}

function mentionedTargets(ctx) {
  const context = quotedContext(ctx.msg)
  const mentioned = context?.mentionedJid || []
  const quotedParticipant = context?.participant ? [context.participant] : []
  const raw = String(ctx.args?.[0] || '').replace(/\D/g, '')
  const numeric = raw.length >= 8 ? [`${raw}@s.whatsapp.net`] : []
  return [...new Set([...mentioned, ...quotedParticipant, ...numeric].filter(Boolean))]
}

async function safeReply(ctx, text) {
  return ctx.sock.sendMessage(ctx.chat, { text }, { quoted: ctx.msg })
}

export const viewOnce = {
  name: 'vv', aliases: ['viewonce', 'veruna'],
  async execute(ctx) {
    try {
      ownerOnly(ctx)
      const c = quotedContext(ctx.msg)
      if (!c?.quotedMessage) throw new Error('Responde a una foto o video de una sola visualización.')
      const target = { key: { remoteJid: ctx.msg.key.remoteJid, id: c.stanzaId, participant: c.participant }, message: c.quotedMessage }
      const content = unwrapMessage(c.quotedMessage)
      const isVideo = Boolean(content.videoMessage)
      const isImage = Boolean(content.imageMessage)
      if (!isVideo && !isImage) throw new Error('El mensaje citado no contiene una foto o video recuperable.')
      await safeReply(ctx, '👁️ Recuperando archivo de una sola visualización...')
      const buffer = await downloadMediaMessage(target, 'buffer', {}, { logger: console, reuploadRequest: ctx.sock.updateMediaMessage })
      if (isVideo) await ctx.sock.sendMessage(ctx.chat, { video: buffer, caption: '✅ Archivo recuperado por Nero Bot.' }, { quoted: ctx.msg })
      else await ctx.sock.sendMessage(ctx.chat, { image: buffer, caption: '✅ Archivo recuperado por Nero Bot.' }, { quoted: ctx.msg })
    } catch (error) { await safeReply(ctx, `❌ ${error.message}`) }
  }
}

export const restart = {
  name: 'restart', aliases: ['reiniciar'],
  async execute(ctx) {
    ownerOnly(ctx)
    await safeReply(ctx, '♻️ Reiniciando Nero Bot mediante PM2...')
    setTimeout(() => process.exit(0), 700)
  }
}

export const ownerInfo = {
  name: 'ownerinfo', aliases: ['ownerstatus'],
  async execute(ctx) {
    ownerOnly(ctx)
    const memory = process.memoryUsage()
    await safeReply(ctx, [
      '👑 *Nero Owner Status*',
      `PID: ${process.pid}`,
      `Node: ${process.version}`,
      `Uptime: ${Math.floor(process.uptime())} s`,
      `RAM: ${(memory.rss / 1024 / 1024).toFixed(1)} MB`,
      `Cuenta: ${ctx.sock.user?.id || 'desconocida'}`
    ].join('\n'))
  }
}

function joinErrorDetails(error) {
  const raw = [
    error?.message,
    error?.data,
    error?.output?.payload?.message,
    error?.output?.payload?.error,
    error?.cause?.message
  ]
    .filter(Boolean)
    .map(value => typeof value === 'string' ? value : JSON.stringify(value))
    .join(' ')
    .toLowerCase()

  const status =
    Number(error?.output?.statusCode || 0) ||
    Number(error?.statusCode || 0) ||
    null

  if (raw.includes('account_reachout_restricted')) {
    return [
      '⚠️ *WhatsApp restringió temporalmente esta cuenta para unirse a grupos mediante invitación.*',
      '',
      'No es un fallo del enlace ni de Nero.',
      'La restricción pertenece a la cuenta de WhatsApp que está ejecutando este comando.',
      '',
      '• Espera antes de intentarlo otra vez.',
      '• Evita repetir .join muchas veces.',
      '• También puedes agregar esa cuenta al grupo directamente desde WhatsApp.',
      '',
      `Instancia: ${error?.neroInstance || 'Nero'}`
    ].join('\n')
  }

  if (
    status === 429 ||
    /rate.?overlimit|too many requests|\b429\b/.test(raw)
  ) {
    return [
      '⏳ *WhatsApp aplicó un límite temporal a las invitaciones.*',
      'Espera unos minutos antes de volver a usar .join.'
    ].join('\n')
  }

  if (
    /invite.*expired|expired.*invite|revoked|not.?found|item-not-found|410/.test(raw)
  ) {
    return [
      '❌ *La invitación parece vencida, revocada o inválida.*',
      'Genera un enlace nuevo del grupo y vuelve a intentarlo.'
    ].join('\n')
  }

  if (
    status === 401 ||
    status === 403 ||
    /not.?authorized|forbidden|not.?allowed/.test(raw)
  ) {
    return [
      '❌ *WhatsApp no autorizó a esta cuenta a unirse mediante ese enlace.*',
      'Comprueba el enlace y el estado de la cuenta antes de volver a intentarlo.'
    ].join('\n')
  }

  return `❌ No se pudo unir al grupo: ${error?.message || 'error desconocido'}`
}

export const joinGroup = {
  name: 'join',
  aliases: ['unirse'],
  async execute(ctx) {
    ownerOnly(ctx)

    const input = ctx.args.join(' ').trim()
    const match = input.match(
      /(?:https?:\/\/)?chat\.whatsapp\.com\/([A-Za-z0-9_-]{10,})/i
    )
    const code = (match?.[1] || input)
      .split(/[?#\s]/)[0]
      .trim()

    if (!code || !/^[A-Za-z0-9_-]{10,}$/.test(code)) {
      await safeReply(
        ctx,
        '❌ Uso: *.join <enlace o código de invitación válido>*'
      )
      return
    }

    const instance =
      ctx.instanceType === 'subbot'
        ? `Subbot +${ctx.instanceId || 'desconocido'}`
        : 'Nero principal'

    try {
      let inviteInfo = null
      if (typeof ctx.sock.groupGetInviteInfo === 'function') {
        inviteInfo = await ctx.sock.groupGetInviteInfo(code).catch(() => null)
      }

      const jid = await ctx.sock.groupAcceptInvite(code)
      let subject = inviteInfo?.subject || ''

      if (!subject && jid) {
        const metadata = await ctx.sock.groupMetadata(jid).catch(() => null)
        subject = metadata?.subject || ''
      }

      await safeReply(
        ctx,
        [
          '✅ *Nero se unió al grupo.*',
          subject ? `👥 Grupo: ${subject}` : null,
          `🆔 ${jid}`,
          `🤖 Instancia: ${instance}`
        ].filter(Boolean).join('\n')
      )
    } catch (error) {
      error.neroInstance = instance
      console.warn('[JOIN]', instance, error?.message || error)
      await safeReply(ctx, joinErrorDetails(error))
    }
  }
}


export const leaveGroup = {
  name: 'leave', aliases: ['salir'],
  async execute(ctx) {
    ownerOnly(ctx)
    if (!ctx.chat.endsWith('@g.us')) throw new Error('Este comando debe usarse dentro del grupo que Nero abandonará.')
    await safeReply(ctx, '👋 Nero abandonará este grupo.')
    await ctx.sock.groupLeave(ctx.chat)
  }
}

function blockCommand(status) {
  return {
    name: status === 'block' ? 'block' : 'unblock',
    aliases: status === 'block' ? ['bloquear'] : ['desbloquear'],
    async execute(ctx) {
      ownerOnly(ctx)
      const target = mentionedTargets(ctx)[0]
      if (!target) throw new Error(`Uso: .${this.name} @usuario o número`)
      await ctx.sock.updateBlockStatus(target, status)
      await safeReply(ctx, `${status === 'block' ? '🚫 Bloqueado' : '✅ Desbloqueado'}: ${target}`)
    }
  }
}

export const setBotName = {
  name: 'setnamebot', aliases: ['setbotname'],
  async execute(ctx) {
    ownerOnly(ctx)
    const name = ctx.args.join(' ').trim()
    if (!name) throw new Error('Uso: .setnamebot <nuevo nombre>')
    await ctx.sock.updateProfileName(name)
    await safeReply(ctx, `✅ Nombre del bot actualizado a: ${name}`)
  }
}

export const setBotPicture = {
  name: 'setppbot', aliases: ['setbotpp'],
  async execute(ctx) {
    ownerOnly(ctx)
    const c = quotedContext(ctx.msg)
    const quoted = c?.quotedMessage
    const current = unwrapMessage(ctx.msg.message || {})
    const sourceMessage = quoted || ctx.msg.message
    const sourceContent = unwrapMessage(sourceMessage || {})
    if (!sourceContent.imageMessage && !current.imageMessage) throw new Error('Responde a una imagen con .setppbot')
    const target = quoted
      ? { key: { remoteJid: ctx.chat, id: c.stanzaId, participant: c.participant }, message: quoted }
      : ctx.msg
    const buffer = await downloadMediaMessage(target, 'buffer', {}, { logger: console, reuploadRequest: ctx.sock.updateMediaMessage })
    const botJid = ctx.sock.user?.id || ctx.sock.user?.jid
    await ctx.sock.updateProfilePicture(botJid, buffer)
    await safeReply(ctx, '✅ Foto de perfil del bot actualizada.')
  }
}

export const broadcast = {
  name: 'broadcast', aliases: ['bc', 'difusion'],
  async execute(ctx) {
    ownerOnly(ctx)
    const text = ctx.args.join(' ').trim()
    if (!text) throw new Error('Uso: .broadcast <mensaje>')
    const groups = await ctx.sock.groupFetchAllParticipating()
    const ids = Object.keys(groups || {})
    await safeReply(ctx, `📣 Iniciando difusión a ${ids.length} grupos...`)
    let sent = 0
    for (const jid of ids) {
      try {
        await ctx.sock.sendMessage(jid, { text: `📣 *COMUNICADO DE NERO BOT*\n\n${text}\n\n> ArcadiaCorps` })
        sent += 1
        await new Promise(resolve => setTimeout(resolve, 700))
      } catch (error) { console.error('[BROADCAST]', jid, error?.message || error) }
    }
    await safeReply(ctx, `✅ Difusión finalizada: ${sent}/${ids.length} grupos.`)
  }
}

export const shellExec = {
  name: 'exec', aliases: ['shell'],
  async execute(ctx) {
    ownerOnly(ctx)
    const command = ctx.args.join(' ').trim()
    if (!command) throw new Error('Uso: .exec <comando del VPS>')
    const { stdout, stderr } = await exec(command, { cwd: process.cwd(), timeout: 30_000, maxBuffer: 512 * 1024 })
    const output = `${stdout || ''}${stderr ? `\nSTDERR:\n${stderr}` : ''}`.trim() || 'Comando ejecutado sin salida.'
    await safeReply(ctx, `🖥️ *Resultado*\n\n${output.slice(0, 3500)}`)
  }
}

export const evaluate = {
  name: 'eval', aliases: ['js'],
  async execute(ctx) {
    ownerOnly(ctx)
    const code = ctx.args.join(' ').trim()
    if (!code) throw new Error('Uso: .eval <JavaScript>')
    const fn = new AsyncFunction('ctx', 'sock', 'msg', 'chat', `return (${code})`)
    const result = await fn(ctx, ctx.sock, ctx.msg, ctx.chat)
    const rendered = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    await safeReply(ctx, `🧪 *Eval*\n\n${String(rendered).slice(0, 3500)}`)
  }
}

export const ownerCommands = [
  viewOnce, restart, ownerInfo, joinGroup, leaveGroup,
  blockCommand('block'), blockCommand('unblock'), setBotName,
  setBotPicture, broadcast, shellExec, evaluate
]
