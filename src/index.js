import 'dotenv/config'
import readline from 'node:readline/promises'
import process from 'node:process'
import path from 'node:path'
import pino from 'pino'
import { Boom } from '@hapi/boom'
import makeWASocket, {
  DisconnectReason,
  jidNormalizedUser,
  useMultiFileAuthState
} from '@whiskeysockets/baileys'
import config from '../config.js'
import { extractText } from './lib/text.js'
import { findCommand } from './commands/index.js'
import { getPermissionLevel, isOwner, isStaff, isSubOwner } from './lib/permissions.js'
import { moderateIncoming } from './lib/nsfwGuard.js'

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

  // Ultra Baileys obtiene automáticamente la versión activa de WhatsApp Web.
  // No fijamos `version`, para permitir que el fork evite rechazos 405/428.
  const sock = makeWASocket({
    auth: state,
    logger,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    connectTimeoutMs: 60_000,
    defaultQueryTimeoutMs: undefined,
    keepAliveIntervalMs: 10_000
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

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue

        const chat = msg.key.remoteJid
        const sender = jidNormalizedUser(msg.key.participant || msg.key.remoteJid)
        const text = extractText(msg.message)

        const wasModerated = await moderateIncoming({ sock, msg, chat, sender, isOwner: isOwner(sender), isSubOwner: isSubOwner(sender) })
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
        const chat = msg.key.remoteJid
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
