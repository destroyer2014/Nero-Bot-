import 'dotenv/config'
import process from 'node:process'
import path from 'node:path'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
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
        'user-agent': 'Nero-Bot/1.6.0',
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

let reconnectTimer = null
let reconnectAttempts = 0
let lastQr = null

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

  // Usamos la misma librería para el socket y para construir mensajes
  // interactivos/carruseles. Mezclar dos implementaciones de Baileys hacía
  // que WhatsApp aceptara la reacción, pero descartara el carrusel.
  const version = await resolveWaVersion()
  if (needsPairing) console.log('📱 Modo de vinculación por QR activado. Esperando QR de WhatsApp...')
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
    browser: ['Nero Bot', 'Chrome', '1.6.0'],
    getMessage: async () => undefined
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect, qr } = update

    if (qr && needsPairing && qr !== lastQr) {
      lastQr = qr
      console.log('\n📱 Escanea este QR desde WhatsApp Business:')
      console.log('Dispositivos vinculados > Vincular un dispositivo.\n')
      qrcode.generate(qr, { small: true })
      console.log('\nMantén esta terminal abierta hasta que la vinculación termine.\n')
    }

    if (connection === 'open') {
      lastQr = null
      reconnectAttempts = 0
      console.log(`✅ ${config.botName} conectado como ${sock.user?.id || 'cuenta vinculada'}`)
      console.log(`📌 Tipo de instancia: ${config.instanceType === 'subbot' ? 'Subbot' : 'Bot principal'}`)
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode
      const loggedOut = statusCode === DisconnectReason.loggedOut

      if (loggedOut) {
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
