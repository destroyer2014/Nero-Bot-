import fs from 'node:fs'
import path from 'node:path'

const CACHE_FILE = path.resolve('sessions', 'lid-cache.json')
let cache = {}

try {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {}
} catch {
  cache = {}
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))
  } catch (error) {
    console.warn('[LID-CACHE] No se pudo guardar la caché:', error?.message || error)
  }
}

// Devuelve el número de teléfono (solo dígitos) previamente resuelto para
// un LID, o null si nunca se resolvió con éxito.
export function getCachedPhoneForLid(lidDigits) {
  return cache[lidDigits] || null
}

// Guarda una resolución LID -> número real. Se llama cada vez que
// resolveSenderIdentity logra resolver un LID por lidMapping o por
// metadata de grupo, para no tener que volver a resolverlo después.
export function setCachedPhoneForLid(lidDigits, phoneDigits) {
  if (!lidDigits || !phoneDigits || lidDigits === phoneDigits) return
  if (cache[lidDigits] === phoneDigits) return
  cache[lidDigits] = phoneDigits
  persist()
}
