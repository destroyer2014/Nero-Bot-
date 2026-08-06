import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { downloadMediaMessage } from '@itsliaaa/baileys'
import { listSubbots, getSubbot } from '../lib/subbotRegistry.js'

const execFileAsync = promisify(execFile)

function ownerOnly(ctx) {
  if (!ctx.isOwner) throw new Error('Este comando es exclusivo para owners.')
}

async function reply(ctx, text) {
  return ctx.sock.sendMessage(ctx.chat, { text }, { quoted: ctx.msg })
}

function quotedContext(msg) {
  return msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo ||
    msg.message?.documentMessage?.contextInfo ||
    null
}

function targetJid(ctx) {
  const c = quotedContext(ctx.msg)
  const mentioned = c?.mentionedJid?.[0]
  if (mentioned) return mentioned
  if (c?.participant) return c.participant
  const raw = String(ctx.args?.[0] || '').replace(/\D/g, '')
  return raw.length >= 8 ? `${raw}@s.whatsapp.net` : null
}

function safeId(value) {
  return String(value || '').replace(/[^0-9A-Za-z._-]/g, '')
}

function fmtBytes(value) {
  const n = Number(value || 0)
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

function readTail(file, lines = 80) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    return text.split('\n').slice(-Math.max(10, Math.min(lines, 200))).join('\n')
  } catch {
    return 'No hay registros disponibles.'
  }
}

export const ownerHelp = {
  name: 'ownerhelp',
  aliases: ['ownermenu'],
  async execute(ctx) {
    ownerOnly(ctx)
    await reply(ctx, [
      '👑 *Comandos Owner seguros*',
      '',
      '.health',
      '.checkenv',
      '.sessions',
      '.botlogs [líneas]',
      '',
      '.groups',
      '.groupinfo [id]',
      '.sendgroup <id> <mensaje>',
      '.leavegroup <id>',
      '.broadcastmedia <texto> (respondiendo a imagen/video/documento)',
      '',
      '.getpp @usuario',
      '',
      '.subbotinfo <id o número>',
      '.subbotlogs <id o número>',
      '.startsubbot <id o número>',
      '.stopsubbot <id o número>',
      '.restartsubbot <id o número>',
      '.orphansubbots',
      '',
      '.id',
      '.code',
      '',
      '🔒 .exec y .eval quedan deshabilitados por seguridad.'
    ].join('\n'))
  }
}

export const health = {
  name: 'health',
  aliases: ['estadoowner'],
  async execute(ctx) {
    ownerOnly(ctx)
    const mem = process.memoryUsage()
    const load = os.loadavg()
    const data = [
      '🩺 *Estado de Nero*',
      `PID: ${process.pid}`,
      `Node: ${process.version}`,
      `Uptime: ${Math.floor(process.uptime())} s`,
      `RAM proceso: ${fmtBytes(mem.rss)}`,
      `RAM libre: ${fmtBytes(os.freemem())}`,
      `RAM total: ${fmtBytes(os.totalmem())}`,
      `CPU load: ${load.map(x => x.toFixed(2)).join(' / ')}`,
      `Plataforma: ${os.platform()} ${os.release()}`
    ]
    await reply(ctx, data.join('\n'))
  }
}

export const checkEnv = {
  name: 'checkenv',
  aliases: [],
  async execute(ctx) {
    ownerOnly(ctx)
    const required = ['EVOGB_API_KEY', 'DVYER_API_KEY']
    const optional = ['NERO_PHONE', 'OWNER_NUMBERS', 'OWNER_LIDS', 'SUBOWNER_NUMBERS', 'SUBOWNER_LIDS']
    const lines = ['🔐 *Variables configuradas*', '']
    for (const key of required) lines.push(`${process.env[key] ? '✅' : '❌'} ${key}`)
    lines.push('')
    for (const key of optional) lines.push(`${process.env[key] ? '✅' : '➖'} ${key}`)
    lines.push('', 'Los valores nunca se muestran.')
    await reply(ctx, lines.join('\n'))
  }
}

export const sessions = {
  name: 'sessions',
  aliases: ['sesiones'],
  async execute(ctx) {
    ownerOnly(ctx)
    const root = path.resolve('sessions')
    let names = []
    try {
      names = fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    } catch {}
    await reply(ctx, [
      '🗂️ *Sesiones locales*',
      `Cantidad: ${names.length}`,
      '',
      ...(names.slice(0, 50).map((name, i) => `${i + 1}. ${name}`)),
      names.length > 50 ? `\n… y ${names.length - 50} más.` : ''
    ].join('\n'))
  }
}

export const botLogs = {
  name: 'botlogs',
  aliases: ['logs'],
  async execute(ctx) {
    ownerOnly(ctx)
    const lines = Number(ctx.args?.[0]) || 80
    const pm2 = path.join(os.homedir(), '.pm2', 'logs')
    const out = readTail(path.join(pm2, 'nero-bot-out.log'), lines)
    const err = readTail(path.join(pm2, 'nero-bot-error.log'), Math.min(lines, 80))
    await reply(ctx, `📄 *Nero logs*\n\nOUT:\n${out.slice(-2500)}\n\nERROR:\n${err.slice(-1000)}`)
  }
}

export const groups = {
  name: 'groups',
  aliases: ['grupos'],
  async execute(ctx) {
    ownerOnly(ctx)
    const data = await ctx.sock.groupFetchAllParticipating()
    const items = Object.values(data || {})
    const lines = ['👥 *Grupos de Nero*', `Total: ${items.length}`, '']
    for (const [i, group] of items.slice(0, 60).entries()) {
      lines.push(`${i + 1}. ${group.subject || 'Sin nombre'}\n${group.id}`)
    }
    await reply(ctx, lines.join('\n').slice(0, 3900))
  }
}

export const groupInfo = {
  name: 'groupinfo',
  aliases: ['infogrupo'],
  async execute(ctx) {
    ownerOnly(ctx)
    const id = ctx.args?.[0] || (String(ctx.chat).endsWith('@g.us') ? ctx.chat : null)
    if (!id) throw new Error('Uso: .groupinfo <id del grupo>')
    const g = await ctx.sock.groupMetadata(id)
    const admins = (g.participants || []).filter(p => p.admin).length
    await reply(ctx, [
      '👥 *Información del grupo*',
      `Nombre: ${g.subject || '?'}`,
      `ID: ${g.id}`,
      `Participantes: ${g.participants?.length || 0}`,
      `Admins: ${admins}`,
      `Owner: ${g.owner || 'No disponible'}`,
      `Descripción: ${(g.desc || 'Sin descripción').slice(0, 700)}`
    ].join('\n'))
  }
}

export const sendGroup = {
  name: 'sendgroup',
  aliases: ['enviargrupo'],
  async execute(ctx) {
    ownerOnly(ctx)
    const [id, ...rest] = ctx.args || []
    const text = rest.join(' ').trim()
    if (!id || !text) throw new Error('Uso: .sendgroup <id> <mensaje>')
    await ctx.sock.sendMessage(id, { text })
    await reply(ctx, '✅ Mensaje enviado al grupo.')
  }
}

export const leaveGroupById = {
  name: 'leavegroup',
  aliases: ['salirgrupo'],
  async execute(ctx) {
    ownerOnly(ctx)
    const id = ctx.args?.[0]
    if (!id) throw new Error('Uso: .leavegroup <id>')
    await ctx.sock.groupLeave(id)
    await reply(ctx, `✅ Nero salió del grupo ${id}.`)
  }
}

export const getProfilePicture = {
  name: 'getpp',
  aliases: ['fotoperfil'],
  async execute(ctx) {
    ownerOnly(ctx)
    const jid = targetJid(ctx)
    if (!jid) throw new Error('Menciona a un usuario o responde a su mensaje.')
    const url = await ctx.sock.profilePictureUrl(jid, 'image').catch(() => null)
    if (!url) throw new Error('La foto no está disponible por privacidad o no existe.')
    await ctx.sock.sendMessage(ctx.chat, {
      image: { url },
      caption: `🖼️ Foto de perfil de ${jid}`
    }, { quoted: ctx.msg })
  }
}

export const broadcastMedia = {
  name: 'broadcastmedia',
  aliases: ['bcmedia'],
  async execute(ctx) {
    ownerOnly(ctx)
    const c = quotedContext(ctx.msg)
    if (!c?.quotedMessage) throw new Error('Responde a una imagen, video o documento.')
    const text = ctx.args.join(' ').trim()
    const target = {
      key: {
        remoteJid: ctx.chat,
        id: c.stanzaId,
        participant: c.participant
      },
      message: c.quotedMessage
    }
    const buffer = await downloadMediaMessage(target, 'buffer', {}, {
      logger: console,
      reuploadRequest: ctx.sock.updateMediaMessage
    })
    const message = c.quotedMessage
    let payload
    if (message.imageMessage) payload = { image: buffer, caption: text || '📣 Comunicado de Nero' }
    else if (message.videoMessage) payload = { video: buffer, caption: text || '📣 Comunicado de Nero' }
    else if (message.documentMessage) {
      payload = {
        document: buffer,
        fileName: message.documentMessage.fileName || 'archivo',
        mimetype: message.documentMessage.mimetype || 'application/octet-stream',
        caption: text || '📣 Comunicado de Nero'
      }
    } else throw new Error('El mensaje citado no es compatible.')

    const all = await ctx.sock.groupFetchAllParticipating()
    const ids = Object.keys(all || {})
    let sent = 0
    for (const id of ids) {
      try {
        await ctx.sock.sendMessage(id, payload)
        sent += 1
        await new Promise(resolve => setTimeout(resolve, 1200))
      } catch {}
    }
    await reply(ctx, `✅ Difusión multimedia terminada: ${sent}/${ids.length}.`)
  }
}

function findBot(input) {
  const clean = safeId(input)
  return getSubbot(clean) || listSubbots().find(bot =>
    String(bot.phone) === clean || String(bot.id) === clean
  )
}

export const subbotInfo = {
  name: 'subbotinfo',
  aliases: [],
  async execute(ctx) {
    ownerOnly(ctx)
    const bot = findBot(ctx.args?.[0])
    if (!bot) throw new Error('Subbot no encontrado.')
    await reply(ctx, [
      '🤖 *Información del subbot*',
      `ID: ${bot.id}`,
      `Número: +${bot.phone}`,
      `Estado: ${bot.status || 'desconocido'}`,
      `PID: ${bot.pid || 'no registrado'}`,
      `Proceso: nero-subbot-${bot.id}`,
      `Grupos: ${Array.isArray(bot.groups) ? bot.groups.length : 0}`,
      `Actualizado: ${bot.updatedAt ? new Date(bot.updatedAt).toLocaleString('es-PE') : '?'}`
    ].join('\n'))
  }
}

async function pm2Action(ctx, action) {
  ownerOnly(ctx)
  const bot = findBot(ctx.args?.[0])
  if (!bot) throw new Error('Subbot no encontrado.')
  const name = `nero-subbot-${safeId(bot.id)}`
  await execFileAsync('pm2', [action, name, '--update-env'], { timeout: 30000 })
  await reply(ctx, `✅ PM2 ${action}: ${name}`)
}

export const startSubbot = { name: 'startsubbot', aliases: [], execute: ctx => pm2Action(ctx, 'start') }
export const stopSubbot = { name: 'stopsubbot', aliases: [], execute: ctx => pm2Action(ctx, 'stop') }
export const restartSubbot = { name: 'restartsubbot', aliases: [], execute: ctx => pm2Action(ctx, 'restart') }

export const subbotLogs = {
  name: 'subbotlogs',
  aliases: [],
  async execute(ctx) {
    ownerOnly(ctx)
    const bot = findBot(ctx.args?.[0])
    if (!bot) throw new Error('Subbot no encontrado.')
    const name = `nero-subbot-${safeId(bot.id)}`
    const root = path.join(os.homedir(), '.pm2', 'logs')
    const out = readTail(path.join(root, `${name}-out.log`), 70)
    const err = readTail(path.join(root, `${name}-error.log`), 40)
    await reply(ctx, `📄 *${name}*\n\nOUT:\n${out.slice(-2400)}\n\nERROR:\n${err.slice(-1000)}`)
  }
}

export const orphanSubbots = {
  name: 'orphansubbots',
  aliases: [],
  async execute(ctx) {
    ownerOnly(ctx)
    const registry = listSubbots().map(bot => `nero-subbot-${safeId(bot.id)}`)
    let processes = []
    try {
      const { stdout } = await execFileAsync('pm2', ['jlist'], { timeout: 20000, maxBuffer: 1024 * 1024 })
      processes = JSON.parse(stdout).map(item => item.name).filter(name => name.startsWith('nero-subbot-'))
    } catch {}
    const missingProcess = registry.filter(name => !processes.includes(name))
    const missingRegistry = processes.filter(name => !registry.includes(name))
    await reply(ctx, [
      '🧭 *Subbots huérfanos*',
      '',
      `Registro sin proceso: ${missingProcess.length}`,
      ...(missingProcess.map(x => `• ${x}`)),
      '',
      `Proceso sin registro: ${missingRegistry.length}`,
      ...(missingRegistry.map(x => `• ${x}`))
    ].join('\n').slice(0, 3900))
  }
}

function disabledSensitive(name) {
  return {
    name,
    aliases: [],
    async execute(ctx) {
      ownerOnly(ctx)
      await reply(ctx, `🔒 .${name} está deshabilitado por seguridad en esta versión.`)
    }
  }
}

export const safeOwnerCommands = [
  ownerHelp, health, checkEnv, sessions, botLogs,
  groups, groupInfo, sendGroup, leaveGroupById,
  getProfilePicture, broadcastMedia,
  subbotInfo, subbotLogs, startSubbot, stopSubbot,
  restartSubbot, orphanSubbots,
  disabledSensitive('exec'),
  disabledSensitive('eval')
]
