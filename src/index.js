import readline from 'node:readline/promises'
import process from 'node:process'
import path from 'node:path'
import pino from 'pino'
import { Boom } from '@hapi/boom'
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  useMultiFileAuthState
} from '@whiskeysockets/baileys'
import config from '../config.js'
import { extractText } from './lib/text.js'
import { findCommand } from './commands/index.js'
import { getPermissionLevel, isOwner, isStaff, isSubOwner } from './lib/permissions.js'

const logger = pino({ level: 'silent' })
const sessionPath = path.resolve('sessions', config.sessionName)
let pairingCodeRequested = false
let reconnecting = false

function cleanPhoneNumber(value = '') {
  return value.replace(/\D/g, '')
}

async function askPhoneNumber() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question('Escribe el número con código de país, sin + ni espacios (ejemplo 51987654321): ')
    const phone = cleanPhoneNumber(answer)
    if (phone.length < 8) throw new Error('El número ingresado no parece válido.')
    return phone
  } finally {
    rl.close()
  }
}

async function startNeroBot() {
  reconnecting = false
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.ubuntu(config.botName),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true
  })

  sock.ev.on('creds.update', saveCreds)

  if (!state.creds.registered && !pairingCodeRequested) {
    pairingCodeRequested = true
    const phone = await askPhoneNumber()
    await new Promise(resolve => setTimeout(resolve, 2000))
    const code = await sock.requestPairingCode(phone)
    console.log(`\nCódigo de vinculación de ${config.botName}: ${code.match(/.{1,4}/g)?.join('-') || code}\n`)
    console.log('WhatsApp > Dispositivos vinculados > Vincular con número de teléfono.\n')
  }

  sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect } = update

    if (connection === 'open') {
      pairingCodeRequested = false
      console.log(`✅ ${config.botName} conectado como ${sock.user?.id || 'cuenta vinculada'}`)
      console.log(`📌 Tipo de instancia: ${config.instanceType === 'subbot' ? 'Subbot' : 'Bot principal'}`)
    }

    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode
      const loggedOut = statusCode === DisconnectReason.loggedOut

      if (loggedOut) {
        pairingCodeRequested = false
        console.error('❌ La sesión fue cerrada desde WhatsApp. Borra la carpeta de sesión y vuelve a vincular.')
        return
      }

      if (!reconnecting) {
        reconnecting = true
        console.log(`⚠️ Conexión cerrada (${statusCode || 'sin código'}). Reconectando...`)
        setTimeout(() => startNeroBot().catch(console.error), 3000)
      }
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
