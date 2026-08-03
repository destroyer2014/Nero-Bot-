import fs from 'node:fs'
import path from 'node:path'

const file = path.resolve('data', 'groups.json')
let state = {}
try { state = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { state = {} }

const defaults = {
  antiNsfw: false,
  antiNsfwDebug: false,
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

function persist() {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(state, null, 2))
}

export function getGroup(chat) {
  state[chat] = { ...defaults, ...(state[chat] || {}), warnings: { ...(state[chat]?.warnings || {}) }, timers: { ...(state[chat]?.timers || {}) } }
  return state[chat]
}
export function patchGroup(chat, patch) { state[chat] = { ...getGroup(chat), ...patch }; persist(); return state[chat] }
export function getWarn(chat, user) { return Number(getGroup(chat).warnings[user] || 0) }
export function setWarn(chat, user, value) { const g=getGroup(chat); g.warnings[user]=Math.max(0,Number(value)||0); if(!g.warnings[user]) delete g.warnings[user]; persist(); return g.warnings[user]||0 }
export function resetWarn(chat, user) { return setWarn(chat,user,0) }
export function saveTimer(chat, type, when) { const g=getGroup(chat); g.timers[type]=when; persist() }
export function clearTimer(chat, type) { const g=getGroup(chat); delete g.timers[type]; persist() }
export function allGroups() { return state }
