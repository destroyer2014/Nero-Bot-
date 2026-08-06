import fs from 'node:fs'
import path from 'node:path'

const file = path.resolve('data', 'sticker-meta.json')
const defaults = { packname: 'Nero Bot', author: 'ArcadiaCorps' }

function load() {
  try { return { ...defaults, ...JSON.parse(fs.readFileSync(file, 'utf8')) } }
  catch { return { ...defaults } }
}

function save(data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

export function getStickerMeta() { return load() }
export function setStickerMeta(patch = {}) {
  const next = { ...load(), ...patch }
  save(next)
  return next
}
