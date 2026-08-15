import fs from 'node:fs'
import path from 'node:path'
import { getGroupPrincipal } from './principalStore.js'
import { listSubbots } from './subbotRegistry.js'
import { isInstanceAlive } from './instanceHeartbeat.js'

const principalFile = path.resolve('runtime', 'principal-instance.json')

const CONTROL_COMMANDS = new Set([
  'setprincipal',
  'setbot',
  'principalpick',
  'principal',
  'resetprincipal',
  'pelicula',
  'peliculapick',
  'premium',
  'addpremium',
  'delpremium',
  'premiumlist'
])

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
      ? [...new Set(
          patch.groups.filter(group => String(group).endsWith('@g.us'))
        )]
      : Array.isArray(current.groups) ? current.groups : [],
    updatedAt: Date.now()
  }

  atomicWrite(principalFile, next)
  return next
}

export function rememberPrincipalGroup(groupId, jid = '') {
  if (!String(groupId || '').endsWith('@g.us')) {
    return getPrincipalPresence()
  }

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
      groups = Object.keys(all || {})
        .filter(groupId => groupId.endsWith('@g.us'))
    }
  } catch (error) {
    console.warn(
      '[INSTANCE ROUTER] principal groups:',
      error?.message || error
    )
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
      const number = digits(value)
      if (number) numeric.add(number)
    }
  }

  return { exact, numeric }
}

function matchesParticipant(value, participants) {
  if (!value) return false
  if (participants.exact.has(String(value))) return true

  const number = digits(value)
  return Boolean(number && participants.numeric.has(number))
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

  const currentIsPrincipal = instanceType === 'principal'
  const principalAlive =
    currentIsPrincipal ||
    isInstanceAlive('principal', 'principal')

  const principalPresent =
    principalAlive &&
    (
      currentIsPrincipal ||
      (principal.groups || []).includes(groupId) ||
      matchesParticipant(principal.jid, participants)
    )

  const subbots = listSubbots()
    .filter(bot => bot.status === 'connected')
    .filter(bot => {
      const botId = String(bot.id || '')
      const currentSelf =
        instanceType === 'subbot' &&
        botId === String(instanceId || '')

      const alive =
        currentSelf ||
        isInstanceAlive('subbot', botId)

      if (!alive) return false

      return (
        subbotBelongsToGroup(bot, groupId, participants) ||
        currentSelf
      )
    })

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

  return {
    principalPresent,
    principal,
    subbots
  }
}

function availableIds(available) {
  return new Set([
    ...(available.principalPresent ? ['principal'] : []),
    ...available.subbots.map(bot => String(bot.id))
  ])
}

function controllerId(available) {
  if (available.principalPresent) return 'principal'
  if (available.subbots.length) {
    return String(available.subbots[0].id)
  }
  return ''
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

  const ids = availableIds(available)
  const controlId = controllerId(available)

  if (explicit && ids.has(String(explicit))) {
    return {
      id: String(explicit),
      controlId: String(explicit),
      source: 'manual',
      explicit: String(explicit),
      ...available
    }
  }

  if (ids.size) {
    return {
      id: 'all',
      controlId,
      source: explicit ? 'fallback-all' : 'free',
      explicit: explicit || null,
      ...available
    }
  }

  const self = instanceType === 'principal'
    ? 'principal'
    : String(instanceId || '')

  return {
    id: 'all',
    controlId: self,
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

  if (route.id !== 'all') {
    return {
      handle: route.id === self,
      route
    }
  }

  const commandName = String(options.commandName || '').toLowerCase()

  if (CONTROL_COMMANDS.has(commandName)) {
    return {
      handle: route.controlId === self,
      route
    }
  }

  const ids = availableIds(route)

  return {
    handle:
      route.source === 'self-fallback' ||
      ids.has(self),
    route
  }
}
