import { downloadMediaMessage } from '@itsliaaa/baileys'
import { requireEvoGbApiKey } from './api.js'
import { getGroup, getWarn, setWarn } from './groupStore.js'
import { getGroupPrincipal } from './principalStore.js'

const mediaKinds = ['imageMessage', 'videoMessage', 'stickerMessage']
const wrapperKinds = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage'
]
const explicitLinkRegex = /(?:https?:\/\/|www\.)[^\s<>{}\[\]]+/i
const domainRegex = /\b(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.)+([a-z]{2,63})(?:[\/:?#][^\s<>{}\[\]]*)?/gi
const nonDomainExtensions = new Set([
  'jpg','jpeg','png','gif','webp','bmp','svg',
  'mp3','m4a','wav','ogg','flac','mp4','mkv','avi','mov','webm',
  'pdf','zip','rar','7z','tar','gz',
  'txt','json','js','ts','css','html',
  'doc','docx','xls','xlsx','ppt','pptx'
])

function containsGlobalLink(value = '') {
  const text = String(value || '').trim()
  if (!text) return false

  if (explicitLinkRegex.test(text)) return true

  domainRegex.lastIndex = 0
  for (const match of text.matchAll(domainRegex)) {
    const tld = String(match[1] || '').toLowerCase()
    if (!nonDomainExtensions.has(tld)) return true
  }

  return false
}


const jidKey = value => String(value || '').replace(/:\d+@/, '@').split('@')[0].replace(/\D/g, '')
const sameIdentity = (a, b) => Boolean(jidKey(a) && jidKey(a) === jidKey(b))
const valuesOf = (participant = {}) => [participant.id, participant.jid, participant.lid, participant.phoneNumber].filter(Boolean)

function unwrapMessage(message = {}) {
  let current = message || {}
  for (let depth = 0; depth < 10; depth += 1) {
    const wrapper = wrapperKinds.find(kind => current?.[kind]?.message)
    if (!wrapper) break
    current = current[wrapper].message || {}
  }
  return current
}

function contextInfoFrom(message = {}) {
  const current = unwrapMessage(message)
  return current.extendedTextMessage?.contextInfo ||
    current.imageMessage?.contextInfo ||
    current.videoMessage?.contextInfo ||
    current.stickerMessage?.contextInfo ||
    current.documentMessage?.contextInfo ||
    {}
}

function mediaTarget(msg) {
  const message = unwrapMessage(msg?.message || {})
  const type = Object.keys(message).find(key => mediaKinds.includes(key))
  if (!type) return null
  return {
    type,
    target: {
      key: msg.key,
      message
    }
  }
}

function quotedTarget(msg) {
  const context = contextInfoFrom(msg?.message || {})
  if (!context?.quotedMessage) return msg
  return {
    key: {
      remoteJid: msg.key.remoteJid,
      id: context.stanzaId,
      participant: context.participant
    },
    message: context.quotedMessage
  }
}

async function adminState(sock, chat, user) {
  const metadata = await sock.groupMetadata(chat).catch(() => null)
  if (!metadata) return { metadata: null, userAdmin: false, botAdmin: false }
  const userCandidates = [user].filter(Boolean)
  const botCandidates = [sock.user?.id, sock.user?.jid, sock.user?.lid].filter(Boolean)
  const find = candidates => metadata.participants.find(participant =>
    valuesOf(participant).some(value => candidates.some(candidate => value === candidate || sameIdentity(value, candidate)))
  )
  return {
    metadata,
    userAdmin: Boolean(find(userCandidates)?.admin),
    botAdmin: Boolean(find(botCandidates)?.admin)
  }
}

async function punishGlobalLink({ sock, msg, chat, sender }) {
  await sock.sendMessage(chat, { delete: msg.key }).catch(error => {
    console.warn(
      '[ANTILINK] No se pudo borrar el mensaje:',
      error?.message || error
    )
  })

  const mention = `@${String(sender || '').split('@')[0].split(':')[0]}`

  try {
    await sock.groupParticipantsUpdate(chat, [sender], 'remove')
    setWarn(chat, sender, 0)

    await sock.sendMessage(chat, {
      text: [
        '「🔗」 *AntiLink*',
        '',
        `Has sido eliminado por enviar enlaces ${mention}`,
        '',
        '> Segurity Nero AI | © ArcadiaCorps'
      ].join('\n'),
      mentions: [sender]
    }).catch(() => {})
  } catch (error) {
    console.warn(
      '[ANTILINK] No se pudo expulsar al usuario:',
      error?.message || error
    )

    await sock.sendMessage(chat, {
      text: [
        '「⚠️」 *AntiLink detectó un enlace*',
        '',
        `No pude expulsar a ${mention}.`,
        'Verifica que Nero siga siendo administrador.',
        '',
        '> Segurity Nero AI | © ArcadiaCorps'
      ].join('\n'),
      mentions: [sender]
    }).catch(() => {})
  }

  return true
}

async function punish({ sock, msg, chat, sender, reason, detail = '', protectedUser = false }) {
  await sock.sendMessage(chat, { delete: msg.key }).catch(error => {
    console.warn('[MODERACIÓN] No se pudo borrar el mensaje:', error?.message || error)
  })

  const mention = `@${String(sender || '').split('@')[0].split(':')[0]}`
  if (protectedUser) {
    await sock.sendMessage(chat, {
      text: `⚠️ *Contenido eliminado*\n\nUsuario: ${mention}\nMotivo: ${reason}${detail ? `\n${detail}` : ''}\nEl usuario es administrador/owner, por eso no se añadió advertencia.`,
      mentions: [sender]
    }).catch(() => {})
    return true
  }

  const count = setWarn(chat, sender, getWarn(chat, sender) + 1)
  if (count >= 3) {
    await sock.sendMessage(chat, {
      text: `🚫 *Usuario expulsado*\n\nUsuario: ${mention}\nMotivo: acumuló 3 advertencias.\nÚltima infracción: ${reason}`,
      mentions: [sender]
    }).catch(() => {})
    await sock.groupParticipantsUpdate(chat, [sender], 'remove').catch(() => {})
    setWarn(chat, sender, 0)
  } else {
    await sock.sendMessage(chat, {
      text: `⚠️ *Mensaje eliminado*\n\nUsuario: ${mention}\nMotivo: ${reason}${detail ? `\n${detail}` : ''}\nAdvertencias: ${count}/3`,
      mentions: [sender]
    }).catch(() => {})
  }
  return true
}

function percent(value) {
  if (typeof value === 'string') value = value.replace('%', '').trim()
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return number <= 1 ? number * 100 : number
}

function scoreFromEvo(data) {
  const scores = Array.isArray(data?.raw_scores)
    ? data.raw_scores
    : Array.isArray(data?.scores)
      ? data.scores
      : []
  const wanted = scores
    .filter(item => ['porn', 'hentai', 'sexy', 'nsfw'].includes(String(item.className || item.label || '').toLowerCase()))
    .map(item => percent(item.number ?? item.score ?? item.original))
    .filter(Number.isFinite)
  const direct = [
    data?.score,
    data?.nsfw_score,
    data?.analysis?.score,
    data?.analysis?.confidence,
    data?.result?.score,
    data?.result?.confidence
  ].map(percent).filter(Number.isFinite)
  const all = [...wanted, ...direct]
  return all.length ? Math.max(...all) : 0
}

async function uploadEvo(buffer, filename, field) {
  const key = requireEvoGbApiKey()
  const base = process.env.EVOGB_API_BASE_URL || 'https://api.evogb.org'
  const url = new URL('/nsfw/detect', base)
  url.searchParams.set('key', key)
  const mime = filename.endsWith('.mp4') ? 'video/mp4' : filename.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
  const form = new FormData()
  form.append(field, new Blob([buffer], { type: mime }), filename)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  try {
    const response = await fetch(url, { method: 'POST', body: form, signal: controller.signal })
    const raw = await response.text()
    let data
    try { data = JSON.parse(raw) } catch { throw new Error(raw.slice(0, 250) || `HTTP ${response.status}`) }
    if (!response.ok || data?.status === false || Number(data?.code || 0) >= 400) {
      const error = new Error(data?.message || data?.error || `HTTP ${response.status}`)
      error.status = Number(data?.code || response.status)
      throw error
    }
    return data
  } finally {
    clearTimeout(timer)
  }
}

async function scanEvo(buffer, filename) {
  let firstError
  for (const field of ['file', 'image']) {
    try {
      return await uploadEvo(buffer, filename, field)
    } catch (error) {
      firstError ||= error
      if (![400, 404, 415, 422].includes(Number(error?.status))) throw error
    }
  }
  throw firstError || new Error('EvoGB no pudo analizar el archivo.')
}

async function analyzeMessage(sock, msg) {
  const quoted = quotedTarget(msg)
  const media = mediaTarget(quoted)
  if (!media) throw new Error('Responde a una imagen, video o sticker para analizarlo.')
  const buffer = await downloadMediaMessage(media.target, 'buffer', {}, {
    logger: console,
    reuploadRequest: sock.updateMediaMessage
  })
  if (!buffer?.length) throw new Error('No se pudo descargar el archivo.')
  const filename = media.type === 'videoMessage'
    ? 'media.mp4'
    : media.type === 'stickerMessage'
      ? 'sticker.webp'
      : 'imagen.jpg'
  const data = await scanEvo(buffer, filename)
  const score = scoreFromEvo(data)
  const flagged = Boolean(data?.analysis?.is_nsfw ?? data?.is_nsfw ?? data?.result?.is_nsfw) || score >= 70
  const flag = String(data?.analysis?.flag || data?.flag || data?.result?.flag || '').trim()
  return { score, flagged, flag, data }
}

export async function analyzeQuotedNsfw(ctx) {
  return analyzeMessage(ctx.sock, ctx.msg)
}

export async function moderateIncoming({
  sock,
  msg,
  chat,
  sender,
  isOwner = false,
  isSubOwner = false,
  text = '',
  instanceType = 'principal',
  instanceId = 'principal'
}) {
  if (!chat?.endsWith('@g.us') || msg?.key?.fromMe) return false

  const selected = getGroupPrincipal(chat) || 'principal'
  const current = instanceType === 'subbot' ? String(instanceId || '') : 'principal'
  if (selected !== current) return false

  const settings = getGroup(chat)
  if (!settings.antiNsfw && !settings.antiLink) return false

  const permissions = await adminState(sock, chat, sender)
  if (!permissions.botAdmin) {
    if (settings.antiNsfwDebug) {
      await sock.sendMessage(chat, { text: '⚠️ Anti-NSFW no puede actuar porque esta instancia no es administradora del grupo.' }, { quoted: msg }).catch(() => {})
    }
    return false
  }

  const protectedUser = Boolean(permissions.userAdmin || isOwner || isSubOwner)
  if (
    settings.antiLink &&
    !protectedUser &&
    containsGlobalLink(text || '')
  ) {
    return punishGlobalLink({ sock, msg, chat, sender })
  }

  if (!settings.antiNsfw || !mediaTarget(msg)) return false

  try {
    const result = await analyzeMessage(sock, msg)
    console.log('[ANTI-NSFW]', {
      chat,
      sender,
      instance: current,
      score: result.score,
      flag: result.flag,
      flagged: result.flagged
    })
    if (settings.antiNsfwDebug) {
      await sock.sendMessage(chat, {
        text: `🛡️ Archivo analizado: ${result.flagged ? 'NSFW' : 'seguro'} (${result.score.toFixed(2)}%)${result.flag ? ` • ${result.flag}` : ''}.`
      }, { quoted: msg }).catch(() => {})
    }
    if (!result.flagged) return false
    return punish({
      sock,
      msg,
      chat,
      sender,
      reason: 'contenido NSFW',
      detail: `Detección: ${result.score.toFixed(2)}%${result.flag ? ` • ${result.flag}` : ''}`,
      protectedUser
    })
  } catch (error) {
    console.warn('[ANTI-NSFW] EvoGB no respondió:', error?.message || error)
    if (settings.antiNsfwDebug) {
      await sock.sendMessage(chat, { text: `⚠️ Anti-NSFW no pudo analizar el archivo: ${error?.message || 'error desconocido'}` }, { quoted: msg }).catch(() => {})
    }
    return false
  }
}
