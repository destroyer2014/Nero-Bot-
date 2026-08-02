import config from '../../config.js'
import { jidToNumber } from './format.js'

function normalizeNumbers(numbers = []) {
  return numbers.map(number => String(number).replace(/\D/g, ''))
}

export function getPermissionLevel(jid = '') {
  const number = jidToNumber(jid)
  const owners = normalizeNumbers(config.ownerNumbers)
  const subOwners = normalizeNumbers(config.subOwnerNumbers)

  if (owners.includes(number)) return 'owner'
  if (subOwners.includes(number)) return 'subowner'
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
