import fs from 'node:fs'
import path from 'node:path'

const file = path.resolve('data', 'favorites.json')
let data = {}

function load() {
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')) || {} } catch { data = {} }
}
function save() {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}
function key(jid = '') { return String(jid).split(':')[0] }

load()

export function getFavorites(jid) {
  return Array.isArray(data[key(jid)]) ? [...data[key(jid)]] : []
}
export function addFavorite(jid, command) {
  const k = key(jid)
  const clean = String(command || '').trim().replace(/^\./, '').toLowerCase()
  if (!clean) return getFavorites(jid)
  const list = new Set(getFavorites(jid))
  list.add(clean)
  data[k] = [...list].slice(0, 30)
  save()
  return getFavorites(jid)
}
export function removeFavorite(jid, command) {
  const k = key(jid)
  const clean = String(command || '').trim().replace(/^\./, '').toLowerCase()
  data[k] = getFavorites(jid).filter(item => item !== clean)
  save()
  return getFavorites(jid)
}
export function clearFavorites(jid) {
  delete data[key(jid)]
  save()
}
