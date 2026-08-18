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
import { findCommand, suggestCommand } from './commands/index.js'
import { unknownCommandMessage } from './lib/unknownCommand.js'
import { startGachaScheduler } from './commands/gacha.js'
import { getPermissionLevel, isOwner, isStaff, isSubOwner } from './lib/permissions.js'
import { moderateIncoming } from './lib/nsfwGuard.js'
import { getGroup } from './lib/groupStore.js'
import { handleAdminParticipantUpdate } from './lib/adminEvents.js'
import { recordCommandError, commandErrorMessage } from './lib/commandErrors.js'
import { consumeSubbotEvents } from './lib/subbotEvents.js'
import { sendInteractive, copyButton } from './lib/interactive.js'
import { getInstanceMode, privateCommandsAllowed } from './lib/modeStore.js'
import { checkCommandRate, rateLimitMessage } from './lib/commandGuard.js'
import { createInstanceHeartbeat } from './lib/instanceHeartbeat.js'
import { hasPendingSubbotPhone, clearPendingSubbotPhone } from './lib/pendingSubbotPhone.js'
import { createSubbotForPhone } from './commands/subbots.js'
import {
  restoreRegisteredSubbots,
  shutdownSubbotProcesses,
  subbotProcessManagerMode
} from './lib/subbotManager.js'
import { getCachedPhoneForLid, setCachedPhoneForLid } from './lib/lidCache.js'
import {
  shouldHandleGroup,
  rememberPrincipalGroup,
  refreshPrincipalPresence
} from './lib/instanceRouter.js'

const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' })
const sessionPath = path.resolve('sessions', config.sessionName)
const instanceHeartbeat = createInstanceHeartbeat('principal', 'principal')

let phoneNumber = null
let pairingCodeRequested = false
let reconnectTimer = null
let reconnectAttempts = 0

let subbotEventTimer = null
let subbotEventSock = null
const recentSubbotEventKeys = new Map()
const SUBBOT_EVENT_DEDUPE_MS = 10 * 60 * 1000

function subbotEventKey(event = {}) {
  return event.dedupeKey ||
    `${event.type || 'event'}:${event.id || event.phone || ''}:${event.code || event.reason || ''}`
}

function pruneSubbotEventKeys() {
  const cutoff = Date.now() - SUBBOT_EVENT_DEDUPE_MS

  for (const [key, at] of recentSubbotEventKeys) {
    if (at < cutoff) recentSubbotEventKeys.delete(key)
  }
}

async function deliverSubbotEvent(event) {
  if (!event?.chat) return

  const sock = subbotEventSock
  if (!sock) throw new Error('El socket principal no está disponible.')

  pruneSubbotEventKeys()

  const key = subbotEventKey(event)
  const lastSent = recentSubbotEventKeys.get(key)

  if (
    lastSent &&
    Date.now() - lastSent < SUBBOT_EVENT_DEDUPE_MS
  ) {
    console.log('[SUBBOT EVENT] Duplicado ignorado:', key)
    return
  }

  if (event.type === 'pairing-code') {
    try {
      await sendInteractive(sock, event.chat, {
        title: 'NERO • Vinculación de subbot',
        body:
          `✅ Sesión para: +${event.phone}\n\n` +
          `Código: *${event.formattedCode || event.code}*\n\n` +
          'En WhatsApp abre Dispositivos vinculados > Vincular con número.',
        footer: 'Nero Bot • El código vence pronto',
        buttons: [copyButton('Copiar código', event.code)]
      }, null)
    } catch {
      await sock.sendMessage(event.chat, {
        text:
          `🔐 *NERO*\n` +
          `Sesión: +${event.phone}\n` +
          `Código: *${event.formattedCode || event.code}*`
      })
    }
  } else if (event.type === 'connected') {
    await sock.sendMessage(event.chat, {
      text:
        '✅ *Ahora eres subbot de Nero.*\n' +
        `Cuenta: +${event.phone}\n` +
        'La instancia quedó guardada y activa.'
    })
  } else if (event.type === 'deleted') {
    await sock.sendMessage(event.chat, {
      text:
        `🗑️ La sesión del subbot +${event.phone} fue eliminada del servidor.\n` +
        `Motivo: ${event.reason || 'sesión cerrada'}`
    })
  } else if (event.type === 'pairing-paused') {
    await sock.sendMessage(event.chat, {
      text:
        `⚠️ *Vinculación pausada para +${event.phone}.*\n\n` +
        `WhatsApp cerró temporalmente la conexión${
          event.statusCode ? ` (HTTP ${event.statusCode})` : ''
        }.\n` +
        'La sesión incompleta *NO fue eliminada del servidor* y Nero no solicitará códigos en bucle.\n\n' +
        'Espera el cooldown y vuelve a usar *.code* si el código anterior no vincula.'
    })
  } else {
    return
  }

  recentSubbotEventKeys.set(key, Date.now())
}

function startSubbotEventConsumer(sock) {
  subbotEventSock = sock

  if (subbotEventTimer) return

  subbotEventTimer = setInterval(() => {
    consumeSubbotEvents(deliverSubbotEvent)
      .catch(error => {
        console.error(
          '[SUBBOT EVENTS]',
          error?.message || error
        )
      })
  }, 1500)

  subbotEventTimer.unref?.()
}

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

function staticLidOverride(lid) {
  const digits = String(lid).split('@')[0].split(':')[0]
  const mappings = [
    [config.ownerLids || [], config.ownerNumbers || []],
    [config.subOwnerLids || [], config.subOwnerNumbers || []]
  ]

  for (const [lids, numbers] of mappings) {
    const idx = lids.indexOf(digits)
    if (idx === -1) continue
    const phone = numbers[idx]
    if (phone) return `${phone}@s.whatsapp.net`
  }

  return null
}

async function resolveSenderIdentity(sock, msg, chat) {
  const initial = resolveSenderJid(msg)
  if (!initial.endsWith('@lid')) return initial

  const lidDigits = initial.split('@')[0].split(':')[0]

  // 0) Override estático: LIDs ya conocidos y registrados a mano en
  // config.js (config.ownerLids <-> config.ownerNumbers). Es el caso
  // más común durante pruebas y no depende de que WhatsApp ya haya
  // entregado el mapeo interno.
  const staticPhone = staticLidOverride(initial)
  if (staticPhone) {
    console.log('[JID] LID resuelto por override estático:', { lid: initial, phoneJid: staticPhone })
    return jidNormalizedUser(staticPhone)
  }

  // 0.5) Caché persistente: si este LID ya se resolvió con éxito antes
  // (en cualquier sesión anterior), lo recordamos y evitamos volver a
  // depender de que WhatsApp entregue el mapeo de nuevo.
  const cachedPhone = getCachedPhoneForLid(lidDigits)
  if (cachedPhone) {
    console.log('[JID] LID resuelto por caché:', { lid: initial, phone: cachedPhone })
    return jidNormalizedUser(`${cachedPhone}@s.whatsapp.net`)
  }

  // 1) Vía oficial de Baileys: el mapeo interno LID -> número real
  // (lidMapping). Es la fuente confiable; a diferencia de adivinar por
  // groupMetadata, no depende de que WhatsApp haya poblado bien el
  // campo phoneNumber del participante (que a veces refleja el propio
  // LID en vez del número real y generaba códigos de vinculación para
  // números que no existen). OJO: solo funciona si WhatsApp ya envió
  // ese mapeo a esta sesión (suele pasar tras haber recibido/decodificado
  // al menos un mensaje de ese contacto); si es la primera vez que este
  // LID le escribe al bot, puede devolver null y caemos al fallback.
  try {
    const resolved = await sock.signalRepository?.lidMapping?.getPNForLID(initial)
    if (resolved) {
      const phoneJid = resolved.includes('@') ? resolved : `${resolved}@s.whatsapp.net`
      const digits = phoneJid.split('@')[0].split(':')[0]
      if (isPhoneJid(phoneJid) && digits !== lidDigits) {
        const normalized = jidNormalizedUser(phoneJid)
        console.log('[JID] LID resuelto por lidMapping:', { lid: initial, phoneJid: normalized })
        setCachedPhoneForLid(lidDigits, digits)
        return normalized
      }
    }
  } catch (error) {
    console.warn('[JID] lidMapping no disponible:', error?.message || error)
  }

  // 2) Fallback: metadata del grupo, solo si el mapeo oficial no respondió.
  if (isGroupJid(chat)) {
    try {
      const metadata = await sock.groupMetadata(chat)
      const participants = metadata?.participants || []
      const match = participants.find(participant => {
        const values = [participant?.id, participant?.lid, participant?.phoneNumber, participant?.jid]
          .filter(Boolean)
          .map(value => String(value))
        return values.some(value => value === initial || value.split('@')[0].split(':')[0] === lidDigits)
      })

      const candidates = [
        match?.phoneNumber,
        match?.jid,
        match?.id,
        msg?.key?.participantAlt,
        msg?.key?.remoteJidAlt
      ].filter(Boolean)

      // Descartamos cualquier candidato cuyos dígitos coincidan con el
      // LID: es el bug conocido de WhatsApp/Baileys que hace que el
      // "phoneNumber" del participante sea en realidad su propio LID.
      const phoneJid = candidates.find(value => {
        if (!isPhoneJid(value)) return false
        return String(value).split('@')[0].split(':')[0] !== lidDigits
      })

      if (phoneJid) {
        const resolved = jidNormalizedUser(phoneJid)
        console.log('[JID] LID resuelto por metadata:', { lid: initial, phoneJid: resolved })
        setCachedPhoneForLid(lidDigits, String(phoneJid).split('@')[0].split(':')[0])
        return resolved
      }

      console.log('[JID] No se pudo resolver LID de forma confiable:', {
        lid: initial,
        participant: match || null
      })
    } catch (error) {
      console.warn('[JID] Error resolviendo LID por metadata:', error?.message || error)
    }
  }

  return initial
}

function formatPairingCode(code = '') {
  return code.match(/.{1,4}/g)?.join('-') || code
}

function scheduleReconnect() {
  if (reconnectTimer) return

  const delay = Math.min(
    30_000,
    4000 * (2 ** Math.max(0, reconnectAttempts - 1))
  )

  console.log(
    `⏳ Reintento de conexión en ${Math.round(delay / 1000)}s...`
  )

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    startNeroBot().catch(
      error => console.error('Error al reconectar:', error)
    )
  }, delay)
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
  startGachaScheduler(sock)

  startSubbotEventConsumer(sock)

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
      instanceHeartbeat.setOnline(true)
      await refreshPrincipalPresence(sock).catch(error =>
        console.warn('[INSTANCE ROUTER]', error?.message || error)
      )
    }

    if (connection === 'close') {
      instanceHeartbeat.setOnline(false)
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


  sock.ev.on('groups.update', () => {
    refreshPrincipalPresence(sock).catch(() => {})
  })

  sock.ev.on('group-participants.update', async update => {
    try {
      const groupId = update?.id || update?.jid || update?.chatId
      const participants = Array.isArray(update?.participants) ? update.participants : []
      const action = String(update?.action || '').toLowerCase()
      if (!groupId || !participants.length) return

      if (await handleAdminParticipantUpdate({
        sock,
        update,
        instanceType: 'principal',
        instanceId: 'principal'
      })) return

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
          try {
            await createSubbotForPhone({ sock, msg, chat, sender, args: [], text }, text)
          } catch (error) {
            await sock.sendMessage(chat, { text: `❌ ${error?.message || 'No se pudo generar el código.'}` }, { quoted: msg }).catch(() => {})
          }
          continue
        }

        const wasModerated = await moderateIncoming({ sock, msg, chat, sender, text, isOwner: isOwner(sender), isSubOwner: isSubOwner(sender) })
        if (wasModerated) continue
        if (!text.startsWith(config.prefix)) continue

        const [rawCommand, ...args] = text.slice(config.prefix.length).trim().split(/\s+/)
        if (!rawCommand) continue

        const command = findCommand(rawCommand)
        if (!command) {
          if (chat.endsWith('@g.us')) {
            rememberPrincipalGroup(
              chat,
              sock.user?.id || sock.user?.jid || ''
            )

            const routing = await shouldHandleGroup({
              sock,
              groupId: chat,
              instanceType: 'principal',
              instanceId: 'principal',
              commandName: '__unknown__'
            })

            if (!routing.handle) continue
          }

          await sock.sendMessage(
            chat,
            {
              text: unknownCommandMessage(
                rawCommand,
                config.prefix,
                suggestCommand(rawCommand)
              )
            },
            { quoted: msg }
          ).catch(() => {})

          continue
        }

        const isPrivateChat = !chat.endsWith('@g.us')
        const instanceMode = getInstanceMode('principal', '')
        if (isPrivateChat && instanceMode === 'groups' && !privateCommandsAllowed(rawCommand)) {
          await sock.sendMessage(chat, {
            text: '🔒 *Nero está configurado en modo Solo grupos.*\nEste comando no está disponible en chats privados.'
          }, { quoted: msg }).catch(() => {})
          continue
        }

        let groupRoute = null

        if (chat.endsWith('@g.us')) {
          rememberPrincipalGroup(chat, sock.user?.id || sock.user?.jid || '')
          const routing = await shouldHandleGroup({
            sock,
            groupId: chat,
            instanceType: 'principal',
            instanceId: 'principal',
            commandName: command.name || rawCommand
          })

          if (!routing.handle) continue
          groupRoute = routing.route
        }

        const rate = checkCommandRate({
          sender,
          chat,
          messageId: msg.key?.id || ''
        })

        if (!rate.allow) {
          const shouldWarn =
            rate.notify &&
            (
              !groupRoute ||
              groupRoute.id === 'principal' ||
              (
                groupRoute.id === 'all' &&
                groupRoute.controlId === 'principal'
              )
            )

          if (shouldWarn) {
            await sock.sendMessage(chat, {
              text: rateLimitMessage(rate)
            }, { quoted: msg }).catch(() => {})
          }

          continue
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
        const code = recordCommandError({
          sender,
          chat,
          text: commandText,
          error,
          instanceType: 'principal'
        })
        if (chat) {
          await sock.sendMessage(chat, {
            text: commandErrorMessage(code, error)
          }, { quoted: msg }).catch(() => {})
        }
      }
    }
  })

  return sock
}

process.on('uncaughtException', error =>
  console.error('Error no controlado:', error)
)

process.on('unhandledRejection', error =>
  console.error('Promesa rechazada:', error)
)

let stoppingForPanel = false

async function stopPanelChildren(signal) {
  if (stoppingForPanel) return
  if (subbotProcessManagerMode() !== 'child') return

  stoppingForPanel = true
  console.log(`[PANEL] ${signal}: cerrando SubBots hijos...`)

  await shutdownSubbotProcesses().catch(error =>
    console.warn(
      '[PANEL] Error cerrando SubBots:',
      error?.message || error
    )
  )

  process.exit(0)
}

process.once('SIGTERM', () => {
  stopPanelChildren('SIGTERM').catch(() => process.exit(0))
})

process.once('SIGINT', () => {
  stopPanelChildren('SIGINT').catch(() => process.exit(0))
})

restoreRegisteredSubbots()
  .then(result => {
    console.log(
      `[SUBBOT RESTORE] gestor=${result.manager} ` +
      `restaurados=${result.restored.length} ` +
      `omitidos=${result.skipped.length}`
    )
  })
  .catch(error =>
    console.warn(
      '[SUBBOT RESTORE]',
      error?.message || error
    )
  )

startNeroBot().catch(error => {
  console.error('No se pudo iniciar Nero Bot:', error)
  process.exitCode = 1
})
