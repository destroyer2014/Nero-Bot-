import config from '../../config.js'
import { jidToNumber } from './format.js'

function normalizeNumbers(numbers = []) {
  return numbers.map(number => String(number).replace(/\D/g, '')).filter(Boolean)
}

function configuredOwnerLids() {
  const envLids = String(process.env.OWNER_LIDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  return normalizeNumbers([...(config.ownerLids || []), ...envLids])
}

function configuredSubOwnerLids() {
  const envLids = String(process.env.SUBOWNER_LIDS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  return normalizeNumbers([...(config.subOwnerLids || []), ...envLids])
}

export function getPermissionLevel(jid = '') {
  const number = jidToNumber(jid)
  const owners = normalizeNumbers(config.ownerNumbers)
  const ownerLids = configuredOwnerLids()
  const subOwners = normalizeNumbers(config.subOwnerNumbers)
  const subOwnerLids = configuredSubOwnerLids()
  const isLid = String(jid).endsWith('@lid')

  if (owners.includes(number) || (isLid && ownerLids.includes(number))) return 'owner'
  if (subOwners.includes(number) || (isLid && subOwnerLids.includes(number))) return 'subowner'
  return 'user'
}

export function isOwner(jid = '') {
  return getPermissionLevel(jid) === 'owner'
}

export function isSubOwner(jid = '') {
  return getPermissionLevel(jid) === 'subowner'
}

export function isStaff(jid = '') {
  return ['owner', 'subowner'].includes(getPermissionLevel(jid))
}
