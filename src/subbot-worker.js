import 'dotenv/config'
import path from 'node:path'
import fs from 'node:fs/promises'
import pino from 'pino'
import { Boom } from '@hapi/boom'
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  jidNormalizedUser
} from '@itsliaaa/baileys'
import config from '../config.js'
import { extractText } from './lib/text.js'
import { findCommand } from './commands/index.js'
import {
  getPermissionLevel,
  isOwner,
  isSubOwner,
  isStaff
} from './lib/permissions.js'
import {
  upsertSubbot,
  getSubbot,
  removeSubbot
} from './lib/subbotRegistry.js'
import { getGroupPrincipal } from './lib/principalStore.js'
import { emitSubbotEvent } from './lib/subbotEvents.js'
import {
  getInstanceMode,
  privateCommandsAllowed
} from './lib/modeStore.js'
import { moderateIncoming } from './lib/nsfwGuard.js'

const args = process.argv.slice(2)
const arg = name => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : ''
}

const id = arg('--id')
const phone = arg('--phone') || id

if (!id || !phone) throw new Error('Faltan --id y --phone')

const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' })
const sessionPath = path.resolve('sessions', 'subbots', id)
const clean = value => String(value || '').replace(/\D/g, '')
const formatCode = code => code?.match(/.{1,4}/g)?.join('-') || code
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

let cleaningUp = false

async function refreshGroups(sock) {
  try {
    if (typeof sock.groupFetchAllParticipating !== 'function') {
      throw new Error('La versión actual de Baileys no expone groupFetchAllParticipating.')
    }

    const groups = await sock.groupFetchAllParticipating()
    const groupIds = Object.keys(groups || {})
      .filter(groupId => groupId.endsWith('@g.us'))

    upsertSubbot({
      id,
      phone,
      groups: groupIds,
      groupsUpdatedAt: Date.now()
    })

    console.log(`[SUBBOT GROUPS] ${id}: ${groupIds.length} grupos`)
    return groupIds
  } catch (error) {
    console.warn('[SUBBOT GROUPS]', error?.message || error)
    return getSubbot(id)?.groups || []
  }
}

function rememberGroup(groupId) {
  if (!groupId?.endsWith('@g.us')) return

  const entry = getSubbot(id)
  const groups = new Set(entry?.groups || [])

  if (groups.has(groupId)) return

  groups.add(groupId)

  upsertSubbot({
    id,
    phone,
    groups: [...groups],
    groupsUpdatedAt: Date.now()
  })
}

async function requestDefaultPairingCode(sock) {
  const phoneNumber = clean(phone)
  let lastError

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await wait(attempt === 1 ? 1500 : 3000)
      const code = await sock.requestPairingCode(phoneNumber)

      if (!code) {
        throw new Error('WhatsApp no devolvió un código de vinculación.')
      }

      return code
    } catch (error) {
      lastError = error
      console.error(
        `[SUBBOT PAIRING] intento ${attempt}/3:`,
        error?.message || error
      )
    }
  }

  throw lastError || new Error('No se pudo solicitar el código de WhatsApp.')
}

async function cleanup(reason = 'sesión cerrada') {
  if (cleaningUp) return
  cleaningUp = true

  const entry = getSubbot(id)

  if (entry?.requestChat) {
    await emitSubbotEvent({
      type: 'deleted',
      chat: entry.requestChat,
      requester: entry.requester,
      id,
      phone,
      reason
    }).catch(() => {})
  }

  await fs.rm(sessionPath, { recursive: true, force: true })
  removeSubbot(id)
  setTimeout(() => process.exit(0), 300)
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath)
  const needsPairing = !state.creds.registered
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: undefined,
    keepAliveIntervalMs: 10000,
    getMessage: async () => undefined
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('groups.update', () => {
    refreshGroups(sock).catch(() => {})
  })

  sock.ev.on('connection.update', async update => {
    const statusCode = new Boom(
      update.lastDisconnect?.error
    )?.output?.statusCode

    if (update.connection === 'open') {
      upsertSubbot({
        id,
        phone,
        status: 'connected',
        connectedAt: Date.now(),
        jid: sock.user?.id,
        platform: 'Desconocido'
      })

      await refreshGroups(sock)

      const delayedRefresh = setTimeout(() => {
        refreshGroups(sock).catch(() => {})
      }, 5000)
      delayedRefresh.unref?.()

      const entry = getSubbot(id)
      if (entry?.requestChat) {
        await emitSubbotEvent({
          type: 'connected',
          chat: entry.requestChat,
          requester: entry.requester,
          id,
          phone
        }).catch(() => {})
      }
    }

    if (update.connection === 'close') {
      if (cleaningUp) return

      if (statusCode === DisconnectReason.loggedOut) {
        await cleanup('sesión cerrada desde WhatsApp')
        return
      }

      if (needsPairing && !state.creds.registered) {
        await cleanup(
          `la conexión se cerró durante la vinculación${statusCode ? ` (HTTP ${statusCode})` : ''}`
        )
        return
      }

      setTimeout(() => {
        start().catch(error => {
          console.error('[SUBBOT RECONNECT]', error)
          process.exitCode = 1
        })
      }, 4000)
    }
  })

  if (needsPairing) {
    try {
      const code = await requestDefaultPairingCode(sock)

      upsertSubbot({
        id,
        phone,
        status: 'pairing',
        pairingCodeAt: Date.now()
      })

      const entry = getSubbot(id)
      if (entry?.requestChat) {
        await emitSubbotEvent({
          type: 'pairing-code',
          chat: entry.requestChat,
          requester: entry.requester,
          id,
          phone,
          code,
          formattedCode: formatCode(code)
        })
      }
    } catch (error) {
      console.error('[SUBBOT PAIRING]', error)

      await cleanup(
        `falló la generación del código: ${error?.message || error}`
      )
      return
    }
  }

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue

        const chat = msg.key.remoteJid
        rememberGroup(chat)

        const sender = jidNormalizedUser(
          msg.key.participant ||
          msg.key.remoteJidAlt ||
          msg.key.remoteJid ||
          ''
        )
        const text = extractText(msg.message)
        const senderIsOwner = isOwner(sender)
        const senderIsSubOwner = isSubOwner(sender)

        const wasModerated = await moderateIncoming({
          sock,
          msg,
          chat,
          sender,
          text,
          isOwner: senderIsOwner,
          isSubOwner: senderIsSubOwner,
          instanceType: 'subbot',
          instanceId: id
        })
        if (wasModerated) continue

        if (!text.startsWith(config.prefix)) continue

        const [raw, ...commandArgs] = text
          .slice(config.prefix.length)
          .trim()
          .split(/\s+/)

        const command = findCommand(raw)
        if (!command) continue

        const privateChat = !chat.endsWith('@g.us')

        if (
          privateChat &&
          getInstanceMode('subbot', id) === 'groups' &&
          !privateCommandsAllowed(raw)
        ) {
          await sock.sendMessage(chat, {
            text: '🔒 *Este subbot está configurado en modo Solo grupos.*\nEste comando no está disponible en chats privados.'
          }, { quoted: msg }).catch(() => {})
          continue
        }

        if (chat.endsWith('@g.us')) {
          const chosen = getGroupPrincipal(chat) || 'principal'
          if (chosen !== id) continue
        }

        await command.execute({
          sock,
          msg,
          chat,
          sender,
          args: commandArgs,
          text,
          permissionLevel: getPermissionLevel(sender),
          isOwner: senderIsOwner,
          isSubOwner: senderIsSubOwner,
          isStaff: isStaff(sender),
          instanceType: 'subbot',
          instanceId: id
        })
      } catch (error) {
        await sock.sendMessage(msg.key.remoteJid, {
          text: `❌ Error: ${error.message}\n\nUsa *.reportar <motivo>* para reportarlo.`
        }, { quoted: msg }).catch(() => {})
      }
    }
  })
}

start().catch(error => {
  console.error(error)
  process.exit(1)
})
