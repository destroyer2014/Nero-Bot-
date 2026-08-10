import 'dotenv/config'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import sharp from 'sharp'
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
import { startGachaScheduler } from './commands/gacha.js'
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
import { emitSubbotEvent } from './lib/subbotEvents.js'
import {
  getInstanceMode,
  privateCommandsAllowed
} from './lib/modeStore.js'
import { moderateIncoming } from './lib/nsfwGuard.js'
import { getSubbotConfig, watchSubbotConfig } from './lib/subbotConfigStore.js'
import { shouldHandleGroup } from './lib/instanceRouter.js'
import { recordCommandError, commandErrorMessage } from './lib/commandErrors.js'
import { handleAdminParticipantUpdate } from './lib/adminEvents.js'

const args = process.argv.slice(2)
const arg = name => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : ''
}

const id = arg('--id')
const phone = arg('--phone') || id
const pairingRequestId = arg('--pairing-request-id') || ''

if (!id || !phone) throw new Error('Faltan --id y --phone')

const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' })
const sessionPath = path.resolve('sessions', 'subbots', id)
const clean = value => String(value || '').replace(/\D/g, '')
const formatCode = code => code?.match(/.{1,4}/g)?.join('-') || code
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const WHATSAPP_PROFILE_NAME_MAX = 25
const PROFILE_BRAND_SUFFIX = ' • ArcadiaCorps'
const FULL_BRAND_CREDIT = 'Made With © ArcadiaCorps'

function profileBaseName(value = '') {
  return String(value || '')
    .replace(/\s*\|\s*Made\s+With\s+©\s*ArcadiaCorps\s*$/i, '')
    .replace(/\s*[•·]\s*ArcadiaCorps\s*$/i, '')
    .trim() || 'Nero'
}

function whatsappProfileName(value = '') {
  const base = profileBaseName(value)
  const allowed = Math.max(
    1,
    WHATSAPP_PROFILE_NAME_MAX - PROFILE_BRAND_SUFFIX.length
  )
  return `${base.slice(0, allowed).trim()}${PROFILE_BRAND_SUFFIX}`
    .slice(0, WHATSAPP_PROFILE_NAME_MAX)
}

function whatsappProfileStatus(value = '') {
  const custom = String(value || '').trim()
  return `${FULL_BRAND_CREDIT}${custom ? ` • ${custom}` : ''}`
    .slice(0, 139)
}

let cleaningUp = false

let pairingPauseHandled = false

async function pausePairing(reason, statusCode = null) {
  if (cleaningUp || pairingPauseHandled) return

  pairingPauseHandled = true
  cleaningUp = true

  upsertSubbot({
    id,
    phone,
    status: 'pairing-paused',
    pairingCode: null,
    pairingCodeAt: null,
    pairingRequestId: pairingRequestId || null,
    pairingPausedAt: Date.now(),
    lastDisconnectCode: statusCode || null,
    lastDisconnectReason: reason
  })

  const entry = getSubbot(id)

  if (entry?.requestChat) {
    await emitSubbotEvent({
      type: 'pairing-paused',
      chat: entry.requestChat,
      requester: entry.requester,
      id,
      phone,
      statusCode,
      reason,
      dedupeKey:
        `pairing-paused:${id}:${statusCode || 'unknown'}`
    }).catch(() => {})
  }

  setTimeout(() => process.exit(0), 300)
}
let sockRef = null
let runtimeConfig = getSubbotConfig(id, {
  botName: config.botName,
  prefix: config.prefix
})
let lastAppliedProfile = {}
let profileQueue = Promise.resolve()
let lastProfileRequestAt = 0

function isRateLimit(error) {
  return /rate[-_ ]?overlimit|too many requests|\b429\b/i.test(
    String(error?.message || error || '')
  )
}

function applyRuntimeConfig(next) {
  runtimeConfig = next
  upsertSubbot({
    id,
    phone,
    config: next,
    displayName: next.botName,
    prefix: next.prefix
  })
  console.log(
    `[SUBBOT CONFIG] ${id}: nombre=${next.botName}, prefijo=${next.prefix}`
  )
}

async function avatarBuffer(next) {
  let input

  if (next.avatarPath) {
    const resolved = path.resolve(next.avatarPath)
    const allowedRoot = path.resolve('runtime', 'subbot-assets', id)
    if (!resolved.startsWith(`${allowedRoot}${path.sep}`) && resolved !== allowedRoot) {
      throw new Error('La ruta del avatar no está permitida.')
    }
    const stat = await fs.stat(resolved)
    if (stat.size > 2 * 1024 * 1024) throw new Error('El avatar supera 2 MB.')
    input = await fs.readFile(resolved)
  } else if (next.avatarUrl) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(next.avatarUrl, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { accept: 'image/*' }
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const type = String(response.headers.get('content-type') || '')
      if (!type.startsWith('image/')) throw new Error('La URL no entrega una imagen.')
      const declared = Number(response.headers.get('content-length') || 0)
      if (declared > 2 * 1024 * 1024) throw new Error('El avatar supera 2 MB.')
      const raw = Buffer.from(await response.arrayBuffer())
      if (raw.length > 2 * 1024 * 1024) throw new Error('El avatar supera 2 MB.')
      input = raw
    } finally {
      clearTimeout(timer)
    }
  } else {
    return null
  }

  return sharp(input)
    .rotate()
    .resize(640, 640, { fit: 'cover' })
    .jpeg({ quality: 88 })
    .toBuffer()
}

async function applyWhatsAppProfile(sock, previous, next) {
  if (!next.applyProfile || !sock?.user) return

  const changedName = next.botName !== previous.botName
  const changedStatus = next.statusText !== previous.statusText
  const changedAvatar =
    next.avatarUrl !== previous.avatarUrl ||
    next.avatarPath !== previous.avatarPath

  if (!changedName && !changedStatus && !changedAvatar) return

  const elapsed = Date.now() - lastProfileRequestAt
  if (elapsed < 5000) await wait(5000 - elapsed)
  lastProfileRequestAt = Date.now()

  const result = {}

  try {
    if (
      changedName &&
      next.botName &&
      typeof sock.updateProfileName === 'function'
    ) {
      await sock.updateProfileName(whatsappProfileName(next.botName))
      result.nameApplied = true
    }

    if (
      changedStatus &&
      typeof sock.updateProfileStatus === 'function'
    ) {
      await sock.updateProfileStatus(whatsappProfileStatus(next.statusText))
      result.statusApplied = true
    }

    if (
      changedAvatar &&
      typeof sock.updateProfilePicture === 'function'
    ) {
      const buffer = await avatarBuffer(next)
      if (buffer) {
        await sock.updateProfilePicture(sock.user.id, buffer)
        result.avatarApplied = true
      }
    }

    lastAppliedProfile = {
      ...lastAppliedProfile,
      ...result,
      lastAppliedAt: Date.now(),
      lastError: null
    }
  } catch (error) {
    const message = isRateLimit(error)
      ? 'WhatsApp aplicó un límite temporal al perfil.'
      : String(error?.message || error)

    lastAppliedProfile = {
      ...lastAppliedProfile,
      lastAppliedAt: Date.now(),
      lastError: message
    }

    console.warn('[SUBBOT PROFILE]', message)
  }

  upsertSubbot({
    id,
    phone,
    profile: lastAppliedProfile
  })
}

applyRuntimeConfig(runtimeConfig)
watchSubbotConfig(id, next => {
  const previous = runtimeConfig
  applyRuntimeConfig(next)

  if (sockRef) {
    profileQueue = profileQueue
      .then(() => applyWhatsAppProfile(sockRef, previous, next))
      .catch(error => console.warn('[SUBBOT PROFILE QUEUE]', error?.message || error))
  }
}, {
  botName: config.botName,
  prefix: config.prefix
})

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

  await wait(1500)

  try {
    const code = await sock.requestPairingCode(phoneNumber)

    if (!code) {
      throw new Error(
        'WhatsApp no devolvió un código de vinculación.'
      )
    }

    return code
  } catch (error) {
    if (isRateLimit(error)) {
      throw new Error(
        'WhatsApp aplicó un límite temporal. ' +
        'Espera antes de solicitar otro código.'
      )
    }

    throw error
  }
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
      reason,
      dedupeKey: `deleted:${id}:${reason}`
    }).catch(() => {})
  }

  await fs.rm(sessionPath, { recursive: true, force: true })
  removeSubbot(id)
  setTimeout(() => process.exit(0), 300)
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath)
  const needsPairing = !state.creds.registered

  if (needsPairing) {
    upsertSubbot({
      id,
      phone,
      status: 'pairing-starting',
      pairingCode: null,
      pairingCodeAt: null,
      pairingRequestId: pairingRequestId || null
    })
  }
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

  sockRef = sock
  sock.ev.on('creds.update', saveCreds)
  startGachaScheduler(sock)

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
        pairingCode: null,
        pairingCodeAt: null,
        pairingRequestId: null,
        connectedAt: Date.now(),
        jid: sock.user?.id,
        platform: 'Desconocido'
      })

      await refreshGroups(sock)
      await applyWhatsAppProfile(sock, {}, runtimeConfig)

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
          phone,
          dedupeKey: `connected:${id}`
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
        await pausePairing(
          `la conexión se cerró durante la vinculación${statusCode ? ` (HTTP ${statusCode})` : ''}`,
          statusCode || null
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

      // Compatibilidad con ArcadiaCorps Web:
      // la API /pairing-code lee esta marca desde PM2.
      const webPairingCode = String(code || '')
        .replace(/[^A-Z0-9]/gi, '')
        .toUpperCase();

      if (!/^[A-Z0-9]{8}$/.test(webPairingCode)) {
        throw new Error('El código de vinculación recibido no tiene el formato esperado.');
      }

      console.log(`[SUBBOT_PAIRING_CODE] ${id} ${webPairingCode}`)

      const pairingCodeAt = Date.now()
      upsertSubbot({
        id,
        phone,
        status: 'pairing',
        pairingCode: webPairingCode,
        pairingCodeAt,
        pairingRequestId: pairingRequestId || null
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
          formattedCode: formatCode(code),
          dedupeKey: `pairing-code:${id}:${code}`
        })
      }
    } catch (error) {
      console.error('[SUBBOT PAIRING]', error)

      const statusCode = new Boom(error)?.output?.statusCode
      await pausePairing(
        `falló la generación del código: ${error?.message || error}`,
        statusCode || null
      )
      return
    }
  }

  sock.ev.on('group-participants.update', async update => {
    try {
      const groupId = update?.id || update?.jid
      const participants = Array.isArray(update?.participants)
        ? update.participants
        : []
      const action = String(update?.action || '').toLowerCase()
      if (!groupId || !participants.length) return

      if (await handleAdminParticipantUpdate({
        sock,
        update,
        instanceType: 'subbot',
        instanceId: id
      })) return

      const isAdd = ['add', 'invite', 'join'].includes(action)
      const isRemove = ['remove', 'leave'].includes(action)
      if (
        (isAdd && !runtimeConfig.welcomeEnabled) ||
        (isRemove && !runtimeConfig.goodbyeEnabled) ||
        (!isAdd && !isRemove)
      ) return

      const metadata = await sock.groupMetadata(groupId).catch(() => null)
      if (!metadata) return

      for (const raw of participants) {
        const participant = typeof raw === 'string'
          ? raw
          : raw?.id || raw?.jid || raw?.lid || raw?.phoneNumber
        if (!participant) continue

        const template = isAdd
          ? runtimeConfig.welcomeText
          : runtimeConfig.goodbyeText

        const text = String(template || '')
          .replaceAll('@user', `@${String(participant).split('@')[0]}`)
          .replaceAll('@group', metadata.subject || 'el grupo')
          .replaceAll('@members', String(metadata.participants?.length || 0))

        await sock.sendMessage(groupId, {
          text,
          mentions: [participant]
        }).catch(() => {})
      }
    } catch (error) {
      console.warn('[SUBBOT WELCOME]', error?.message || error)
    }
  })

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
          instanceId: id,
          prefix: runtimeConfig.prefix,
          botName: runtimeConfig.botName,
          subbotConfig: runtimeConfig,
          packName: runtimeConfig.packName,
          packAuthor: runtimeConfig.packAuthor
        })
        if (wasModerated) continue

        if (runtimeConfig.autoRead) await sock.readMessages([msg.key]).catch(() => {})
        if (!text.startsWith(runtimeConfig.prefix)) continue

        const [raw, ...commandArgs] = text
          .slice(runtimeConfig.prefix.length)
          .trim()
          .split(/\s+/)

        const command = findCommand(raw)
        if (!command) continue
        if (runtimeConfig.disabledCommands.includes(String(command.name || raw).toLowerCase())) continue

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
          const { handle } = await shouldHandleGroup({
            sock,
            groupId: chat,
            instanceType: 'subbot',
            instanceId: id
          })
          if (!handle) continue
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
          instanceId: id,
          prefix: runtimeConfig.prefix,
          botName: runtimeConfig.botName,
          subbotConfig: runtimeConfig,
          packName: runtimeConfig.packName,
          packAuthor: runtimeConfig.packAuthor
        })
      } catch (error) {
        console.error('[SUBBOT COMMAND ERROR]', error)
        const chat = msg.key.remoteJid
        const commandText = extractText(msg.message || {})
        const code = recordCommandError({
          sender,
          chat,
          text: commandText,
          error,
          instanceType: 'subbot'
        })
        await sock.sendMessage(chat, {
          text: commandErrorMessage(code, error)
        }, { quoted: msg }).catch(() => {})
      }
    }
  })
}

start().catch(error => {
  console.error(error)
  process.exit(1)
})
