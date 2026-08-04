import 'dotenv/config'
import readline from 'node:readline/promises'
import process from 'node:process'
import path from 'node:path'
import pino from 'pino'
import { Boom } from '@hapi/boom'
import makeWASocket, {
  DisconnectReason,
  jidNormalizedUser,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} from '@itsliaaa/baileys'
import config from '../config.js'
import { extractText } from './lib/text.js'
import { findCommand } from './commands/index.js'
import { getPermissionLevel, isOwner, isStaff, isSubOwner } from './lib/permissions.js'
import { moderateIncoming } from './lib/nsfwGuard.js'
import { getGroup } from './lib/groupStore.js'
import { rememberError } from './lib/errorReports.js'
import { getGroupPrincipal } from './lib/principalStore.js'
import { consumeSubbotEvents } from './lib/subbotEvents.js'
import { sendInteractive, copyButton } from './lib/interactive.js'
import { getInstanceMode, privateCommandsAllowed } from './lib/modeStore.js'
import { hasPendingSubbotPhone, clearPendingSubbotPhone } from './lib/pendingSubbotPhone.js'
import { createSubbotForPhone } from './commands/subbots.js'

const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' })
const sessionPath = path.resolve('sessions', config.sessionName)

let phoneNumber = null
let pairingCodeRequested = false
let reconnectTimer = null
let reconnectAttempts = 0

function cleanPhoneNumber(value = '') {
  return String(value).replace(/\D/g, '')
}

async function askPhoneNumber() {
  if (phoneNumber) return phoneNumber

  const configuredNumber = cleanPhoneNumber(process.env.NERO_PHONE || '')
  if (configuredNumber.length >= 8) {
    phoneNumber = configuredNumber
    return phoneNumber
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(
      'Escribe el número de la cuenta a vincular, con código de país y solo dígitos (ejemplo 51987654321): '
    )
    const phone = cleanPhoneNumber(answer)
    if (phone.length < 8 || phone.length > 15) {
      throw new Error('El número debe tener entre 8 y 15 dígitos, incluyendo el código de país.')
    }
    phoneNumber = phone
    return phoneNumber
  } finally {
    rl.close()
  }
}


function isGroupJid(jid = '') {
  return typeof jid === 'string' && jid.endsWith('@g.us')
}

function isPhoneJid(jid = '') {
  return typeof jid === 'string' && jid.endsWith('@s.whatsapp.net')
}

function resolveChatJid(msg) {
  const key = msg?.key || {}
  const remote = key.remoteJid || ''

  // Los grupos deben conservar siempre su JID @g.us.
  if (isGroupJid(remote)) return remote

  // En chats privados con direccionamiento LID, Baileys suele incluir
  // el JID telefónico equivalente en remoteJidAlt/participantAlt.
  const candidates = [
    key.remoteJidAlt,
    key.participantAlt,
    key.participant,
    remote
  ]

  return candidates.find(isPhoneJid) || remote
}

function resolveSenderJid(msg) {
  const key = msg?.key || {}
  const candidates = [
    key.participantAlt,
    key.participant,
    key.remoteJidAlt,
    key.remoteJid
  ]
  return jidNormalizedUser(candidates.find(isPhoneJid) || candidates.find(Boolean) || '')
}

async function resolveSenderIdentity(sock, msg, chat) {
  const initial = resolveSenderJid(msg)
  if (!initial.endsWith('@lid') || !isGroupJid(chat)) return initial

  try {
    const metadata = await sock.groupMetadata(chat)
    const participants = metadata?.participants || []
    const raw = initial.split('@')[0].split(':')[0]
    const match = participants.find(participant => {
      const values = [participant?.id, participant?.lid, participant?.phoneNumber, participant?.jid]
        .filter(Boolean)
        .map(value => String(value))
      return values.some(value => value === initial || value.split('@')[0].split(':')[0] === raw)
    })

    const candidates = [
      match?.phoneNumber,
      match?.jid,
      match?.id,
      msg?.key?.participantAlt,
      msg?.key?.remoteJidAlt
    ].filter(Boolean)

    const phoneJid = candidates.find(isPhoneJid)
    if (phoneJid) {
      const resolved = jidNormalizedUser(phoneJid)
      console.log('[JID] LID resuelto por metadata:', { lid: initial, phoneJid: resolved })
      return resolved
    }

    console.log('[JID] No se pudo resolver LID por metadata:', {
      lid: initial,
      participant: match || null
    })
  } catch (error) {
    console.warn('[JID] Error resolviendo LID:', error?.message || error)
  }

  return initial
}

function formatPairingCode(code = '') {
  return code.match(/.{1,4}/g)?.join('-') || code
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    startNeroBot().catch(error => console.error('Error al reconectar:', error))
  }, 4000)
}

async function startNeroBot() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath)
  const needsPairing = !state.creds.registered

  if (needsPairing) {
    await askPhoneNumber()
    pairingCodeRequested = false
  }

  const { version } = await fetchLatestBaileysVersion()
  console.log('[BAILEYS] Usando versión:', version.join('.'))

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    getMessage: async () => undefined,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: undefined,
    keepAliveIntervalMs: 10_000
  })

  sock.ev.on('creds.update', saveCreds)

  const eventTimer = setInterval(() => consumeSubbotEvents(async event => {
    if (!event?.chat) return
    if (event.type === 'pairing-code') {
      await sendInteractive(sock, event.chat, {
        title: 'NERO • Vinculación de subbot',
        body: `✅ Sesión para: +${event.phone}\n\nCódigo: *${event.code}*\n\nEn WhatsApp abre Dispositivos vinculados > Vincular con número.`,
        footer: 'Nero Bot • El código vence pronto',
        buttons: [copyButton('Copiar código NERO', event.code)]
      }, null).catch(() => sock.sendMessage(event.chat, { text: `🔐 *NERO*\nSesión: +${event.phone}\nCódigo: *${event.code}*` }))
    } else if (event.type === 'connected') {
      await sock.sendMessage(event.chat, { text: `✅ *Ahora eres subbot de Nero.*\nCuenta: +${event.phone}\nLa instancia quedó guardada y activa con PM2.` }).catch(() => {})
    } else if (event.type === 'deleted') {
      await sock.sendMessage(event.chat, { text: `🗑️ La sesión del subbot +${event.phone} fue eliminada del VPS.\nMotivo: ${event.reason || 'sesión cerrada'}` }).catch(() => {})
    }
  }).catch(error => console.error('[SUBBOT EVENTS]', error)), 1500)
  eventTimer.unref()

  // El código de vinculación puede solicitarse inmediatamente después
  // de crear el socket. Un breve margen evita carreras durante el arranque.
  if (needsPairing && !pairingCodeRequested) {
    pairingCodeRequested = true
    await new Promise(resolve => setTimeout(resolve, 1500))
    try {
      const code = await sock.requestPairingCode(phoneNumber)
      console.log(`\n🔐 Código de vinculación de ${config.botName}: ${formatPairingCode(code)}\n`)
      console.log('En WhatsApp: Dispositivos vinculados > Vincular un dispositivo > Vincular con número de teléfono.\n')
      console.log('Mantén este proceso abierto hasta que aparezca el mensaje de conexión exitosa.\n')
    } catch (error) {
      pairingCodeRequested = false
      const statusCode = new Boom(error)?.output?.statusCode
      console.error(`❌ No se pudo generar el código${statusCode ? ` (HTTP ${statusCode})` : ''}:`, error?.message || error)
      throw error
    }
  }

  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect } = update

    if (connection === 'open') {
      pairingCodeRequested = false
      reconnectAttempts = 0
      phoneNumber = null
      console.log(`✅ ${config.botName} conectado como ${sock.user?.id || 'cuenta vinculada'}`)
      console.log(`📌 Tipo de instancia: ${config.instanceType === 'subbot' ? 'Subbot' : 'Bot principal'}`)
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode
      const loggedOut = statusCode === DisconnectReason.loggedOut

      if (loggedOut) {
        pairingCodeRequested = false
        phoneNumber = null
        console.error('❌ WhatsApp cerró la sesión. Elimina la carpeta de esta sesión y vuelve a vincular.')
        return
      }

      reconnectAttempts += 1
      if (needsPairing && [405, 428].includes(statusCode) && reconnectAttempts >= 2) {
        console.error(`❌ WhatsApp rechazó la vinculación (${statusCode}). Se detuvo el bucle para evitar intentos repetidos.`)
        return
      }

      console.log(`⚠️ Conexión cerrada (${statusCode || 'sin código'}). Reconectando...`)
      scheduleReconnect()
    }
  })


  sock.ev.on('group-participants.update', async update => {
    try {
      const groupId = update?.id || update?.jid || update?.chatId
      const participants = Array.isArray(update?.participants) ? update.participants : []
      const action = String(update?.action || '').toLowerCase()
      if (!groupId || !participants.length) return
      const settings = getGroup(groupId)
      const isAdd = ['add','invite','join'].includes(action)
      const isRemove = ['remove','leave'].includes(action)
      if ((!isAdd && !isRemove) || (isAdd && !settings.welcome) || (isRemove && !settings.goodbye)) return
      const metadata = await sock.groupMetadata(groupId).catch(() => null)
      if (!metadata) return
      console.log(isAdd ? '[WELCOME] Usuarios añadidos:' : '[GOODBYE] Usuarios retirados:', participants)
      for (const rawParticipant of participants) {
        const participant = typeof rawParticipant === 'string' ? rawParticipant : (rawParticipant?.id || rawParticipant?.jid || rawParticipant?.lid || rawParticipant?.phoneNumber)
        if (!participant) continue
        const template = isAdd ? settings.welcomeText : settings.goodbyeText
        const text = String(template || '')
          .replaceAll('@user', `@${participant.split('@')[0]}`)
          .replaceAll('@group', metadata.subject || 'el grupo')
          .replaceAll('@members', String(metadata.participants?.length || 0))
          .replaceAll('@date', new Date().toLocaleDateString('es-PE', { timeZone: config.timezone }))
          .replaceAll('@time', new Date().toLocaleTimeString('es-PE', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }))
        const image = isAdd ? settings.welcomeImage : settings.goodbyeImage
        if (image) {
          const fs = await import('node:fs/promises')
          let media = { url: image }
          try { media = await fs.readFile(image) } catch {}
          await sock.sendMessage(groupId, { image: media, caption: text, mentions: [participant] })
        } else await sock.sendMessage(groupId, { text, mentions: [participant] })
      }
    } catch (error) { console.error('[WELCOME/GOODBYE]', error?.message || error) }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue

        const chat = resolveChatJid(msg)
        const sender = await resolveSenderIdentity(sock, msg, chat)

        if (msg.key.remoteJid?.endsWith('@lid')) {
          console.log('[JID] Mensaje privado con LID:', {
            remoteJid: msg.key.remoteJid,
            remoteJidAlt: msg.key.remoteJidAlt,
            participant: msg.key.participant,
            participantAlt: msg.key.participantAlt,
            resolvedChat: chat,
            resolvedSender: sender
          })
        }
        const text = extractText(msg.message)

        if (hasPendingSubbotPhone(chat, sender) && /^\+?\d[\d\s-]{7,18}$/.test(text.trim())) {
          clearPendingSubbotPhone(chat, sender)
          await createSubbotForPhone({ sock, msg, chat, sender, args: [], text }, text)
          continue
        }

        const wasModerated = await moderateIncoming({ sock, msg, chat, sender, text, isOwner: isOwner(sender), isSubOwner: isSubOwner(sender) })
        if (wasModerated) continue
        if (!text.startsWith(config.prefix)) continue

        const [rawCommand, ...args] = text.slice(config.prefix.length).trim().split(/\s+/)
        if (!rawCommand) continue

        const command = findCommand(rawCommand)
        if (!command) continue

        const isPrivateChat = !chat.endsWith('@g.us')
        const instanceMode = getInstanceMode('principal', '')
        if (isPrivateChat && instanceMode === 'groups' && !privateCommandsAllowed(rawCommand)) {
          await sock.sendMessage(chat, {
            text: '🔒 *Nero está configurado en modo Solo grupos.*\nEste comando no está disponible en chats privados.'
          }, { quoted: msg }).catch(() => {})
          continue
        }

        if (chat.endsWith('@g.us')) {
          const chosen = getGroupPrincipal(chat) || 'principal'
          if (chosen !== 'principal') continue
        }

        await command.execute({
          sock,
          msg,
          chat,
          sender,
          args,
          text,
          permissionLevel: getPermissionLevel(sender),
          isOwner: isOwner(sender),
          isSubOwner: isSubOwner(sender),
          isStaff: isStaff(sender),
          instanceType: 'principal',
          instanceId: 'principal'
        })
      } catch (error) {
        console.error('Error procesando mensaje:', error)
        const chat = resolveChatJid(msg)
        const sender = await resolveSenderIdentity(sock, msg, chat).catch(() => resolveSenderJid(msg))
        const commandText = extractText(msg.message || {})
        const code = rememberError({ sender, chat, command: commandText.split(/\s+/)[0] || '', error, instanceType: 'principal' })
        if (chat) {
          await sock.sendMessage(chat, { text: `❌ Ocurrió un error al ejecutar el comando.\n\nCódigo: *${code}*\nPara reportarlo usa: *.reportar <motivo>*` }, { quoted: msg }).catch(() => {})
        }
      }
    }
  })

  return sock
}

process.on('uncaughtException', error => console.error('Error no controlado:', error))
process.on('unhandledRejection', error => console.error('Promesa rechazada:', error))

startNeroBot().catch(error => {
  console.error('No se pudo iniciar Nero Bot:', error)
  process.exitCode = 1
})
