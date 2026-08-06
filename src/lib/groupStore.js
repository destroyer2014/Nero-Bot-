import fs from 'node:fs'
import path from 'node:path'

const file = path.resolve('data', 'groups.json')
let state = {}

const defaults = {
  antiNsfw: false,
  antiNsfwDebug: false,
  adultContent: false,
  antiLink: false,
  antiSpam: false,
  welcome: false,
  goodbye: false,
  welcomeText: '👋 Bienvenido @user a @group. Ahora somos @members miembros.',
  goodbyeText: '👋 Adiós @user. Gracias por haber formado parte de @group.',
  welcomeImage: '',
  goodbyeImage: '',
  warnings: {},
  timers: {}
}

function reload() {
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { state = {} }
  return state
}

function persist() {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2))
  fs.renameSync(temporary, file)
}

function normalizedGroup(chat) {
  const current = state[chat] || {}
  return {
    ...defaults,
    ...current,
    warnings: { ...(current.warnings || {}) },
    timers: { ...(current.timers || {}) }
  }
}

export function getGroup(chat) {
  reload()
  state[chat] = normalizedGroup(chat)
  return state[chat]
}

export function patchGroup(chat, patch) {
  reload()
  state[chat] = { ...normalizedGroup(chat), ...patch }
  persist()
  return state[chat]
}

export function getWarn(chat, user) {
  return Number(getGroup(chat).warnings[user] || 0)
}

export function setWarn(chat, user, value) {
  reload()
  const group = normalizedGroup(chat)
  group.warnings[user] = Math.max(0, Number(value) || 0)
  if (!group.warnings[user]) delete group.warnings[user]
  state[chat] = group
  persist()
  return group.warnings[user] || 0
}

export function resetWarn(chat, user) {
  return setWarn(chat, user, 0)
}

export function saveTimer(chat, type, when) {
  reload()
  const group = normalizedGroup(chat)
  group.timers[type] = when
  state[chat] = group
  persist()
}

export function clearTimer(chat, type) {
  reload()
  const group = normalizedGroup(chat)
  delete group.timers[type]
  state[chat] = group
  persist()
}

export function allGroups() {
  reload()
  return state
}
