import 'dotenv/config'
import readline from 'node:readline/promises'
import process from 'node:process'
import path from 'node:path'
import pino from 'pino'
import { Boom } from '@hapi/boom'
import {
  makeWASocket,
  DisconnectReason,
  jidNormalizedUser,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys'
import config from '../config.js'
import { extractText } from './lib/text.js'
import { findCommand } from './commands/index.js'
import { getPermissionLevel, isOwner, isStaff, isSubOwner } from './lib/permissions.js'
import { moderateIncoming } from './lib/nsfwGuard.js'
import { getGroup } from './lib/groupStore.js'

const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' })
const sessionPath = path.resolve('sessions', config.sessionName)


const DEFAULT_WA_VERSION = [2, 3000, 1034074495]
const BAILEYS_VERSION_URL = 'https://raw.githubusercontent.com/WhiskeySockets/Baileys/refs/heads/master/src/Defaults/baileys-version.json'

function parseWaVersion(value) {
  if (Array.isArray(value) && value.length === 3) {
    const parsed = value.map(Number)
    return parsed.every(Number.isInteger) ? parsed : null
  }

  const parts = String(value || '')
    .trim()
    .replace(/[\[\]]/g, '')
    .split(/[.,\s]+/)
    .filter(Boolean)
    .map(Number)

  return parts.length === 3 && parts.every(Number.isInteger) ? parts : null
}

async function fetchJsonWithTimeout(url, timeoutMs = 10_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Nero-Bot/1.5.6',
        accept: 'application/json,text/plain,*/*'
      }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function resolveWaVersion() {
  const configured = parseWaVersion(process.env.NERO_WA_VERSION)
  if (configured) {
    console.log(`◆ WA Web v${configured.join('.')} (configurada en NERO_WA_VERSION)`)
    return configured
  }

  try {
    const payload = await fetchJsonWithTimeout(BAILEYS_VERSION_URL)
    const remote = parseWaVersion(payload?.version)
    if (!remote) throw new Error('Respuesta sin una versión válida')
    console.log(`◆ WA Web v${remote.join('.')} (actualizada desde Baileys oficial)`)
    return remote
  } catch (error) {
    console.warn(`⚠️ No se pudo consultar la versión WA Web actual: ${error?.message || error}`)
    console.warn(`⚠️ Se usará el respaldo v${DEFAULT_WA_VERSION.join('.')}. Puedes cambiarlo con NERO_WA_VERSION=2,3000,XXXXXXXXXX`)
    return DEFAULT_WA_VERSION
  }
}

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

  // Usamos la misma librería para el socket y para construir mensajes
  // interactivos/carruseles. Mezclar dos implementaciones de Baileys hacía
  // que WhatsApp aceptara la reacción, pero descartara el carrusel.
  const version = await resolveWaVersion()
  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    logger,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: undefined,
    keepAliveIntervalMs: 10_000,
    browser: ['Nero Bot', 'Chrome', '1.5.6'],
    getMessage: async () => undefined
  })

  sock.ev.on('creds.update', saveCreds)

  // El fork documenta que el código puede solicitarse inmediatamente después
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
      const settings = getGroup(update.id)
      if (!settings.welcome && !settings.goodbye) return
      const metadata = await sock.groupMetadata(update.id).catch(() => null)
      if (!metadata) return
      for (const participant of update.participants || []) {
        const isAdd = update.action === 'add'
        const isRemove = update.action === 'remove'
        if ((isAdd && !settings.welcome) || (isRemove && !settings.goodbye) || (!isAdd && !isRemove)) continue
        const template = isAdd ? settings.welcomeText : settings.goodbyeText
        const text = String(template || '')
          .replaceAll('@user', `@${participant.split('@')[0]}`)
          .replaceAll('@group', metadata.subject || 'el grupo')
          .replaceAll('@members', String(metadata.participants?.length || 0))
          .replaceAll('@date', new Date().toLocaleDateString('es-PE', { timeZone: config.timezone }))
          .replaceAll('@time', new Date().toLocaleTimeString('es-PE', { timeZone: config.timezone, hour: '2-digit', minute: '2-digit' }))
        const image = isAdd ? settings.welcomeImage : settings.goodbyeImage
        if (image) await sock.sendMessage(update.id, { image: { url: image }, caption: text, mentions: [participant] })
        else await sock.sendMessage(update.id, { text, mentions: [participant] })
      }
    } catch (error) { console.error('[BIENVENIDA]', error?.message || error) }
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

        const wasModerated = await moderateIncoming({ sock, msg, chat, sender, text, isOwner: isOwner(sender), isSubOwner: isSubOwner(sender) })
        if (wasModerated) continue
        if (!text.startsWith(config.prefix)) continue

        const [rawCommand, ...args] = text.slice(config.prefix.length).trim().split(/\s+/)
        if (!rawCommand) continue

        const command = findCommand(rawCommand)
        if (!command) continue

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
          isStaff: isStaff(sender)
        })
      } catch (error) {
        console.error('Error procesando mensaje:', error)
        const chat = resolveChatJid(msg)
        if (chat) {
          await sock.sendMessage(chat, { text: '❌ Ocurrió un error al ejecutar el comando.' }, { quoted: msg }).catch(() => {})
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
