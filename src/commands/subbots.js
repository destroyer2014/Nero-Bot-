import config from '../../config.js'
import { sendInteractive, singleSelect } from '../lib/interactive.js'
import {
  canRequestCode,
  markCodeRequest,
  startSubbotProcess,
  deleteSubbot
} from '../lib/subbotManager.js'
import { setPendingSubbotPhone } from '../lib/pendingSubbotPhone.js'
import { listSubbots, getSubbot } from '../lib/subbotRegistry.js'
import {
  setGroupPrincipal,
  getGroupPrincipal,
  resetGroupPrincipal
} from '../lib/principalStore.js'
import {
  getAvailableGroupInstances,
  resolveGroupInstance
} from '../lib/instanceRouter.js'

const num = jid => String(jid || '')
  .split('@')[0]
  .split(':')[0]
  .replace(/\D/g, '')

const fmt = ms => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${days ? `${days}d ` : ''}${hours}h ${minutes}m`
}

async function groupParticipantDigits(sock, groupId) {
  try {
    const metadata = await sock.groupMetadata(groupId)
    const values = []

    for (const participant of metadata?.participants || []) {
      values.push(
        participant?.id,
        participant?.jid,
        participant?.lid,
        participant?.phoneNumber
      )
    }

    return new Set(values.map(num).filter(Boolean))
  } catch {
    return new Set()
  }
}

function subbotBelongsToGroup(bot, groupId, participants) {
  if (Array.isArray(bot.groups) && bot.groups.includes(groupId)) return true

  const jidNumber = num(bot.jid)
  if (jidNumber && participants.has(jidNumber)) return true

  const phoneNumber = num(bot.phone)
  return Boolean(phoneNumber && participants.has(phoneNumber))
}

async function connectedSubbotsInGroup(ctx) {
  const participants = await groupParticipantDigits(ctx.sock, ctx.chat)

  return listSubbots().filter(bot => {
    return bot.status === 'connected' &&
      subbotBelongsToGroup(bot, ctx.chat, participants)
  })
}

export async function createSubbotForPhone(ctx, rawPhone) {
  const phone = String(rawPhone || '').replace(/\D/g, '')

  if (phone.length < 8 || phone.length > 15) {
    throw new Error(
      'El número debe tener entre 8 y 15 dígitos e incluir el código de país.'
    )
  }

  const wait = canRequestCode(ctx.sender)
  if (wait > 0) {
    throw new Error(
      `Debes esperar ${Math.ceil(wait / 1000)} segundos para volver a generar un código.`
    )
  }

  const id = phone
  const old = getSubbot(id)

  if (old?.status === 'connected') {
    throw new Error('Ese número ya tiene un subbot conectado.')
  }

  markCodeRequest(ctx.sender)

  await startSubbotProcess({
    id,
    phone,
    requestChat: ctx.chat,
    requester: ctx.sender
  })

  await ctx.sock.sendMessage(ctx.chat, {
    text: `⏳ *NERO está preparando el código para +${phone}.*\nPuede tardar unos segundos. Recibirás el código en este mismo chat.`
  }, { quoted: ctx.msg })
}

export const codeCommand = {
  name: 'code',
  aliases: ['jadibot'],
  async execute(ctx) {
    try {
      if (ctx.args[0]) {
        await createSubbotForPhone(ctx, ctx.args[0])
        return
      }

      const detected = num(ctx.sender)
      const detectedOk =
        !String(ctx.sender).endsWith('@lid') &&
        detected.length >= 8 &&
        detected.length <= 15

      if (!detectedOk) {
        const wait = canRequestCode(ctx.sender)

        if (wait > 0) {
          await ctx.sock.sendMessage(ctx.chat, {
            text: `⏳ Debes esperar ${Math.ceil(wait / 1000)} segundos para volver a intentarlo.`
          }, { quoted: ctx.msg })
          return
        }

        setPendingSubbotPhone(ctx.chat, ctx.sender)

        await ctx.sock.sendMessage(ctx.chat, {
          text: '📱 *No pude detectar tu número automáticamente.*\nEscribe ahora tu número real con código de país y solo dígitos.\n\nEjemplo: *51912345678*\nTienes 2 minutos para responder.'
        }, { quoted: ctx.msg })

        return
      }

      await createSubbotForPhone(ctx, detected)
    } catch (error) {
      console.error('[SUBBOT .code]', error)

      await ctx.sock.sendMessage(ctx.chat, {
        text: `❌ ${error?.message || 'No se pudo generar el código.'}`
      }, { quoted: ctx.msg }).catch(() => {})
    }
  }
}

export const botsCommand = {
  name: 'bots',
  aliases: ['subbots'],
  async execute(ctx) {
    const bots = listSubbots()
    const online = bots.filter(bot => bot.status === 'connected')
    const lines = [
      '🤖 *Subbots de Nero*',
      `Conectados: ${online.length}`,
      `Registrados: ${bots.length}`,
      ''
    ]

    for (const [index, bot] of bots.entries()) {
      const groupCount = Array.isArray(bot.groups) ? bot.groups.length : 0
      lines.push(
        `${index + 1}. +${bot.phone} | ${bot.status || 'desconocido'} | ${fmt(Date.now() - (bot.connectedAt || bot.startedAt || Date.now()))} | grupos: ${groupCount}`
      )
    }

    await ctx.sock.sendMessage(ctx.chat, {
      text: lines.join('\n')
    }, { quoted: ctx.msg })
  }
}

export const setPrincipalCommand = {
  name: 'setprincipal',
  aliases: ['setbot'],
  async execute(ctx) {
    if (!ctx.chat.endsWith('@g.us')) {
      throw new Error('Este comando solo funciona en grupos.')
    }

    const available = await getAvailableGroupInstances(
      ctx.sock,
      ctx.chat,
      {
        instanceType: ctx.instanceType,
        instanceId: ctx.instanceId
      }
    )

    const automatic = await resolveGroupInstance({
      sock: ctx.sock,
      groupId: ctx.chat,
      instanceType: ctx.instanceType,
      instanceId: ctx.instanceId
    })

    const current = getGroupPrincipal(ctx.chat)
    const all = [
      ...(available.principalPresent
        ? [{
            id: 'principal',
            phone: 'Nero principal',
            status: 'connected'
          }]
        : []),
      ...available.subbots
    ]

    if (!all.length) {
      throw new Error('No se detectaron instancias de Nero disponibles.')
    }

    const rows = all.map(bot => ({
      title: bot.id === 'principal'
        ? 'Nero principal'
        : `+${bot.phone}`,
      description: `${
        bot.id === 'principal'
          ? 'Bot principal'
          : 'Subbot del grupo'
      } • ${
        String(bot.id) === String(current)
          ? 'seleccionado manualmente'
          : (!current && String(bot.id) === String(automatic.id))
            ? 'automático'
            : bot.status
      }`,
      id: `${config.prefix}principalpick ${bot.id}`
    }))

    const body = all.length > 1
      ? 'Selecciona la única instancia que responderá comandos en este grupo.'
      : 'Solo hay una instancia de Nero en este grupo; responderá automáticamente aunque no uses .setbot.'

    await sendInteractive(ctx.sock, ctx.chat, {
      title: 'Elegir bot del grupo',
      body,
      buttons: [
        singleSelect('Seleccionar instancia', [
          {
            title: 'Instancias disponibles',
            rows
          }
        ])
      ]
    }, ctx.msg)
  }
}

export const principalPickCommand = {
  name: 'principalpick',
  aliases: [],
  async execute(ctx) {
    if (!ctx.chat.endsWith('@g.us')) return

    const id = String(ctx.args[0] || '')
    if (!id) throw new Error('Selección inválida.')

    const available = await getAvailableGroupInstances(
      ctx.sock,
      ctx.chat,
      {
        instanceType: ctx.instanceType,
        instanceId: ctx.instanceId
      }
    )

    const ids = new Set([
      ...(available.principalPresent ? ['principal'] : []),
      ...available.subbots.map(bot => String(bot.id))
    ])

    if (!ids.has(id)) {
      throw new Error(
        'Esa instancia no está conectada o no pertenece a este grupo.'
      )
    }

    setGroupPrincipal(ctx.chat, id)

    const selected = id === 'principal'
      ? 'Nero principal'
      : `+${getSubbot(id)?.phone || id}`

    await ctx.sock.sendMessage(ctx.chat, {
      text:
        `✅ *${selected}* será la única instancia que responderá comandos en este grupo.\n` +
        `Para volver al modo automático usa *${config.prefix}resetprincipal*.`
    }, { quoted: ctx.msg })
  }
}

export const principalInfoCommand = {
  name: 'principal',
  aliases: [],
  async execute(ctx) {
    if (!ctx.chat.endsWith('@g.us')) {
      throw new Error('Este comando solo funciona en grupos.')
    }

    const explicit = getGroupPrincipal(ctx.chat)
    const route = await resolveGroupInstance({
      sock: ctx.sock,
      groupId: ctx.chat,
      instanceType: ctx.instanceType,
      instanceId: ctx.instanceId
    })

    const selected = route.id === 'principal'
      ? 'Nero principal'
      : `+${getSubbot(route.id)?.phone || route.id}`

    await ctx.sock.sendMessage(ctx.chat, {
      text: [
        `🤖 Instancia que responde: *${selected}*`,
        explicit
          ? '🎯 Modo: selección manual (.setbot)'
          : '⚙️ Modo: selección automática',
        route.source === 'fallback'
          ? '⚠️ La selección guardada no está disponible; Nero está usando una instancia disponible temporalmente.'
          : null
      ].filter(Boolean).join('\n')
    }, { quoted: ctx.msg })
  }
}

export const resetPrincipalCommand = {
  name: 'resetprincipal',
  aliases: [],
  async execute(ctx) {
    if (!ctx.chat.endsWith('@g.us')) {
      throw new Error('Este comando solo funciona en grupos.')
    }

    resetGroupPrincipal(ctx.chat)

    const route = await resolveGroupInstance({
      sock: ctx.sock,
      groupId: ctx.chat,
      instanceType: ctx.instanceType,
      instanceId: ctx.instanceId
    })

    const selected = route.id === 'principal'
      ? 'Nero principal'
      : `+${getSubbot(route.id)?.phone || route.id}`

    await ctx.sock.sendMessage(ctx.chat, {
      text:
        '✅ El grupo volvió a *selección automática*.\n' +
        `Ahora responderá: *${selected}*.`
    }, { quoted: ctx.msg })
  }
}

export const logoutSubbotCommand = {
  name: 'logout',
  aliases: ['stopbot', 'delbot'],
  async execute(ctx) {
    const id = num(ctx.sender)

    if (!getSubbot(id)) {
      throw new Error('No tienes un subbot registrado.')
    }

    await ctx.sock.sendMessage(ctx.chat, {
      text: '🗑️ Tu sesión de subbot será eliminada del VPS.'
    }, { quoted: ctx.msg })

    await deleteSubbot(id)
  }
}

export const subbotCommands = [
  codeCommand,
  botsCommand,
  setPrincipalCommand,
  principalPickCommand,
  principalInfoCommand,
  resetPrincipalCommand,
  logoutSubbotCommand
]
