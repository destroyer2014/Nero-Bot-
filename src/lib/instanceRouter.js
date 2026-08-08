import fs from 'node:fs'
import path from 'node:path'
import { getGroupPrincipal } from './principalStore.js'
import { listSubbots } from './subbotRegistry.js'

const principalFile = path.resolve('runtime', 'principal-instance.json')

function digits(value = '') {
  return String(value)
    .split('@')[0]
    .split(':')[0]
    .replace(/\D/g, '')
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temp, JSON.stringify(data, null, 2))
  fs.renameSync(temp, file)
}

export function getPrincipalPresence() {
  try {
    return JSON.parse(fs.readFileSync(principalFile, 'utf8'))
  } catch {
    return { jid: '', groups: [], updatedAt: 0 }
  }
}

function writePrincipalPresence(patch = {}) {
  const current = getPrincipalPresence()
  const next = {
    ...current,
    ...patch,
    groups: Array.isArray(patch.groups)
      ? [...new Set(patch.groups.filter(group => String(group).endsWith('@g.us')))]
      : Array.isArray(current.groups) ? current.groups : [],
    updatedAt: Date.now()
  }
  atomicWrite(principalFile, next)
  return next
}

export function rememberPrincipalGroup(groupId, jid = '') {
  if (!String(groupId || '').endsWith('@g.us')) return getPrincipalPresence()
  const current = getPrincipalPresence()
  const groups = new Set(current.groups || [])
  groups.add(groupId)
  return writePrincipalPresence({
    jid: jid || current.jid || '',
    groups: [...groups]
  })
}

export async function refreshPrincipalPresence(sock) {
  const jid = sock?.user?.id || sock?.user?.jid || ''
  let groups = []
  try {
    if (typeof sock?.groupFetchAllParticipating === 'function') {
      const all = await sock.groupFetchAllParticipating()
      groups = Object.keys(all || {}).filter(groupId => groupId.endsWith('@g.us'))
    }
  } catch (error) {
    console.warn('[INSTANCE ROUTER] principal groups:', error?.message || error)
    groups = getPrincipalPresence().groups || []
  }
  return writePrincipalPresence({ jid, groups })
}

function participantValues(participant = {}) {
  if (typeof participant === 'string') return [participant]
  return [
    participant.id,
    participant.jid,
    participant.lid,
    participant.phoneNumber
  ].filter(Boolean)
}

function participantSet(metadata) {
  const exact = new Set()
  const numeric = new Set()
  for (const participant of metadata?.participants || []) {
    for (const value of participantValues(participant)) {
      exact.add(String(value))
      const n = digits(value)
      if (n) numeric.add(n)
    }
  }
  return { exact, numeric }
}

function matchesParticipant(value, participants) {
  if (!value) return false
  if (participants.exact.has(String(value))) return true
  const n = digits(value)
  return Boolean(n && participants.numeric.has(n))
}

function subbotBelongsToGroup(bot, groupId, participants) {
  if (Array.isArray(bot.groups) && bot.groups.includes(groupId)) return true
  if (matchesParticipant(bot.jid, participants)) return true
  return matchesParticipant(bot.phone, participants)
}

async function groupParticipants(sock, groupId) {
  try {
    const metadata = await sock.groupMetadata(groupId)
    return participantSet(metadata)
  } catch {
    return { exact: new Set(), numeric: new Set() }
  }
}

export async function getAvailableGroupInstances(
  sock,
  groupId,
  { instanceType = '', instanceId = '' } = {}
) {
  const participants = await groupParticipants(sock, groupId)
  const principal = getPrincipalPresence()

  const principalPresent =
    instanceType === 'principal' ||
    (principal.groups || []).includes(groupId) ||
    matchesParticipant(principal.jid, participants)

  const subbots = listSubbots()
    .filter(bot => bot.status === 'connected')
    .filter(bot =>
      subbotBelongsToGroup(bot, groupId, participants) ||
      (
        instanceType === 'subbot' &&
        String(bot.id) === String(instanceId)
      )
    )

  if (
    instanceType === 'subbot' &&
    instanceId &&
    !subbots.some(bot => String(bot.id) === String(instanceId))
  ) {
    subbots.push({
      id: String(instanceId),
      phone: String(instanceId),
      status: 'connected',
      groups: [groupId]
    })
  }

  subbots.sort((a, b) =>
    String(a.id || '').localeCompare(String(b.id || ''))
  )

  return { principalPresent, principal, subbots }
}

export async function resolveGroupInstance({
  sock,
  groupId,
  instanceType = '',
  instanceId = ''
}) {
  const explicit = getGroupPrincipal(groupId)
  const available = await getAvailableGroupInstances(
    sock,
    groupId,
    { instanceType, instanceId }
  )

  const ids = new Set([
    ...(available.principalPresent ? ['principal'] : []),
    ...available.subbots.map(bot => String(bot.id))
  ])

  if (explicit && ids.has(String(explicit))) {
    return {
      id: String(explicit),
      source: 'manual',
      explicit: String(explicit),
      ...available
    }
  }

  if (available.principalPresent) {
    return {
      id: 'principal',
      source: explicit ? 'fallback' : 'automatic',
      explicit: explicit || null,
      ...available
    }
  }

  if (available.subbots.length) {
    return {
      id: String(available.subbots[0].id),
      source: explicit ? 'fallback' : 'automatic',
      explicit: explicit || null,
      ...available
    }
  }

  return {
    id: instanceType === 'principal'
      ? 'principal'
      : String(instanceId || ''),
    source: 'self-fallback',
    explicit: explicit || null,
    ...available
  }
}

export async function shouldHandleGroup(options) {
  const route = await resolveGroupInstance(options)
  const self = options.instanceType === 'principal'
    ? 'principal'
    : String(options.instanceId || '')
  return { handle: route.id === self, route }
}
