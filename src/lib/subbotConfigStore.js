import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('runtime', 'subbot-configs')
const waitBuffer = new Int32Array(new SharedArrayBuffer(4))
const MAX_LOCK_AGE_MS = 30_000

const defaults = Object.freeze({
  botName: 'Nero Bot',
  prefix: '.',
  statusText: '',
  avatarUrl: '',
  avatarPath: '',
  autoRead: false,
  welcomeEnabled: true,
  goodbyeEnabled: true,
  welcomeText: '👋 Bienvenido @user a @group.',
  goodbyeText: '👋 Hasta luego @user.',
  disabledCommands: [],
  packName: 'Nero Stickers',
  packAuthor: 'ArcadiaCorps',
  applyProfile: false
})

const sleep = ms => Atomics.wait(waitBuffer, 0, 0, ms)
const cleanText = (value, max) => String(value ?? '').trim().slice(0, max)

function cleanId(value) {
  const id = cleanText(value, 80)
  if (!/^[0-9A-Za-z._-]{3,80}$/.test(id)) {
    throw new Error('El ID del subbot contiene caracteres inválidos.')
  }
  return id
}

function pathsFor(id) {
  const safe = cleanId(id)
  const file = path.join(root, `${safe}.json`)
  return { file, lock: `${file}.lock` }
}

function cleanPrefix(value) {
  const prefix = cleanText(value, 4)
  if (!prefix || /\s/.test(prefix)) {
    throw new Error('El prefijo debe tener entre 1 y 4 caracteres y no contener espacios.')
  }
  return prefix
}

function cleanCommands(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(item => cleanText(item, 50).toLowerCase())
    .filter(Boolean))]
}

function cleanAvatarUrl(value) {
  const url = cleanText(value, 1000)
  if (!url) return ''
  let parsed
  try { parsed = new URL(url) } catch { throw new Error('La URL del avatar no es válida.') }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('El avatar debe usar http o https.')
  }
  return parsed.toString()
}

export function normalizeSubbotConfig(value = {}, fallback = {}) {
  const source = { ...defaults, ...fallback, ...(value || {}) }
  return {
    botName: cleanText(source.botName, 40) || defaults.botName,
    prefix: cleanPrefix(source.prefix || defaults.prefix),
    statusText: cleanText(source.statusText, 139),
    avatarUrl: cleanAvatarUrl(source.avatarUrl),
    avatarPath: cleanText(source.avatarPath, 500),
    autoRead: Boolean(source.autoRead),
    welcomeEnabled: source.welcomeEnabled !== false,
    goodbyeEnabled: source.goodbyeEnabled !== false,
    welcomeText: cleanText(source.welcomeText, 1000) || defaults.welcomeText,
    goodbyeText: cleanText(source.goodbyeText, 1000) || defaults.goodbyeText,
    disabledCommands: cleanCommands(source.disabledCommands),
    packName: cleanText(source.packName, 50) || defaults.packName,
    packAuthor: cleanText(source.packAuthor, 50) || defaults.packAuthor,
    applyProfile: Boolean(source.applyProfile),
    updatedAt: Number(source.updatedAt) || Date.now()
  }
}

function readFile(id, fallback = {}) {
  const { file } = pathsFor(id)
  try {
    return normalizeSubbotConfig(JSON.parse(fs.readFileSync(file, 'utf8')), fallback)
  } catch {
    return normalizeSubbotConfig({}, fallback)
  }
}

function writeFile(id, data) {
  const { file } = pathsFor(id)
  fs.mkdirSync(root, { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2))
  fs.renameSync(temporary, file)
}

function removeStaleLock(lock) {
  try {
    const age = Date.now() - fs.statSync(lock).mtimeMs
    if (age > MAX_LOCK_AGE_MS) fs.rmSync(lock, { force: true })
  } catch {}
}

function withLock(id, handler) {
  const { lock } = pathsFor(id)
  fs.mkdirSync(root, { recursive: true })
  let descriptor

  for (let attempt = 0; attempt < 150; attempt += 1) {
    removeStaleLock(lock)
    try {
      descriptor = fs.openSync(lock, 'wx')
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      sleep(20)
    }
  }

  if (descriptor === undefined) {
    throw new Error('No se pudo actualizar la configuración del subbot.')
  }

  try {
    return handler()
  } finally {
    fs.closeSync(descriptor)
    fs.rmSync(lock, { force: true })
  }
}

export function getSubbotConfig(id, fallback = {}) {
  return readFile(id, fallback)
}

export function setSubbotConfig(id, patch = {}, fallback = {}) {
  return withLock(id, () => {
    const current = readFile(id, fallback)
    const updated = normalizeSubbotConfig(
      { ...current, ...patch, updatedAt: Date.now() },
      fallback
    )
    writeFile(id, updated)
    return updated
  })
}

export function removeSubbotConfig(id) {
  const { file, lock } = pathsFor(id)
  fs.rmSync(file, { force: true })
  fs.rmSync(lock, { force: true })
}

export function watchSubbotConfig(id, handler, fallback = {}) {
  const { file } = pathsFor(id)
  fs.mkdirSync(root, { recursive: true })
  if (!fs.existsSync(file)) writeFile(id, normalizeSubbotConfig({}, fallback))

  let closed = false
  let lastMtime = 0
  let lastUpdatedAt = 0

  const check = () => {
    if (closed) return
    try {
      const mtime = fs.statSync(file).mtimeMs
      if (mtime === lastMtime) return
      lastMtime = mtime
      const next = readFile(id, fallback)
      if (next.updatedAt === lastUpdatedAt) return
      lastUpdatedAt = next.updatedAt
      handler(next)
    } catch (error) {
      console.warn('[SUBBOT CONFIG]', error?.message || error)
    }
  }

  check()
  const timer = setInterval(check, 1000)
  timer.unref?.()

  return () => {
    closed = true
    clearInterval(timer)
  }
}
