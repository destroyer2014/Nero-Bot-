import { jidNormalizedUser } from '@itsliaaa/baileys'
import { getGroupPrincipal } from './principalStore.js'

const pendingActors = new Map()
const recentAnnouncements = new Map()
const PENDING_TTL = 15_000
const RECENT_TTL = 8_000

function cleanMaps() {
  const now = Date.now()
  for (const [key, value] of pendingActors) {
    if (now - value.at > PENDING_TTL) pendingActors.delete(key)
  }
  for (const [key, at] of recentAnnouncements) {
    if (now - at > RECENT_TTL) recentAnnouncements.delete(key)
  }
}

function jidFrom(value) {
  if (!value) return ''
  if (typeof value === 'string') return jidNormalizedUser(value)

  const candidate =
    value.id ||
    value.jid ||
    value.lid ||
    value.phoneNumber ||
    value.author ||
    value.participant ||
    ''

  return candidate ? jidNormalizedUser(String(candidate)) : ''
}

function token(jid = '') {
  return String(jid || '')
    .replace(/:\d+@/, '@')
    .split('@')[0]
    .split(':')[0]
}

function sameIdentity(a = '', b = '') {
  const aa = token(a)
  const bb = token(b)
  return Boolean(aa && bb && aa === bb)
}

function keyFor(groupId, action, target) {
  return `${groupId}|${action}|${token(target)}`
}

function actorFromUpdate(update = {}) {
  const candidates = [
    update.author,
    update.authorPn,
    update.authorLid,
    update.actor,
    update.by,
    update.admin,
    update.creator,
    update.sender
  ]

  for (const value of candidates) {
    const jid = jidFrom(value)
    if (jid) return jid
  }
  return ''
}

function targetFrom(value) {
  return jidFrom(value)
}

function mention(jid = '') {
  return `@${token(jid)}`
}

async function sendNotice(sock, groupId, action, target, actor = '') {
  const targetMention = mention(target)
  const actorMention = actor ? mention(actor) : ''

  const line = action === 'promote'
    ? actor
      ? `${actorMention} le dio admin a ${targetMention}`
      : `Un administrador le dio admin a ${targetMention}`
    : actor
      ? `${actorMention} quitó admin a ${targetMention}`
      : `Un administrador quitó admin a ${targetMention}`

  const mentions = [actor, target].filter(Boolean)

  await sock.sendMessage(groupId, {
    text: [
      action === 'promote'
        ? '「👑」 *Nuevo administrador*'
        : '「📉」 *Administrador removido*',
      '',
      line,
      '',
      '> Nero AI | © ArcadiaCorps'
    ].join('\n'),
    mentions
  }).catch(error => {
    console.warn('[ADMIN EVENT] No se pudo enviar aviso:', error?.message || error)
  })
}

export function rememberAdminActor(groupId, target, action, actor) {
  if (!groupId || !target || !['promote', 'demote'].includes(action)) return
  cleanMaps()

  pendingActors.set(keyFor(groupId, action, target), {
    actor: jidFrom(actor),
    at: Date.now()
  })
}

export async function announceAdminAction({
  sock,
  groupId,
  target,
  action,
  actor = ''
}) {
  const targetJid = targetFrom(target)
  if (!sock || !groupId || !targetJid || !['promote', 'demote'].includes(action)) {
    return false
  }

  cleanMaps()
  const key = keyFor(groupId, action, targetJid)

  if (recentAnnouncements.has(key)) return true

  let actorJid = jidFrom(actor)
  if (actorJid && sameIdentity(actorJid, targetJid)) actorJid = ''

  recentAnnouncements.set(key, Date.now())
  pendingActors.delete(key)

  await sendNotice(sock, groupId, action, targetJid, actorJid)
  return true
}

export async function handleAdminParticipantUpdate({
  sock,
  update,
  instanceType = 'principal',
  instanceId = 'principal'
}) {
  const groupId = update?.id || update?.jid || update?.chatId || ''
  const action = String(update?.action || '').toLowerCase()

  if (!groupId || !['promote', 'demote'].includes(action)) return false

  const selected = getGroupPrincipal(groupId) || 'principal'
  const current = instanceType === 'subbot'
    ? String(instanceId || '')
    : 'principal'

  // Solo la instancia asignada al grupo debe emitir el aviso.
  if (selected !== current) return true

  const participants = Array.isArray(update?.participants)
    ? update.participants
    : []

  if (!participants.length) return true

  cleanMaps()
  const updateActor = actorFromUpdate(update)

  for (const raw of participants) {
    const target = targetFrom(raw)
    if (!target) continue

    const key = keyFor(groupId, action, target)
    if (recentAnnouncements.has(key)) continue

    const pending = pendingActors.get(key)
    let actor = updateActor || pending?.actor || ''

    if (actor && sameIdentity(actor, target)) actor = ''

    recentAnnouncements.set(key, Date.now())
    pendingActors.delete(key)

    await sendNotice(sock, groupId, action, target, actor)
  }

  return true
}
