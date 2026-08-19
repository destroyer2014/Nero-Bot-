import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve('runtime', 'gacha')
const stateFile = path.join(root, 'state.json')
const lockFile = path.join(root, 'state.lock')
const backupDir = path.join(root, 'backups')
const waitBuffer = new Int32Array(new SharedArrayBuffer(4))
const LOCK_STALE_MS = 30_000

function freshState() {
  return {
    version: 1,
    createdAt: Date.now(),
    users: {},
    groups: {},
    catalog: {},
    activeSpawns: {},
    trades: {},
    gifts: {},
    market: {},
    auctions: {},
    banners: {},
    events: {},
    codes: {},
    bans: {},
    recentMarket: [],
    tradeHistory: [],
    boss: null,
    global: {
      rolls: 0,
      claims: 0,
      coinsGenerated: 0
    }
  }
}

function ensureRoot() {
  fs.mkdirSync(root, { recursive: true })
  fs.mkdirSync(backupDir, { recursive: true })
}

function normalizeState(value) {
  const base = freshState()
  const state = value && typeof value === 'object' ? value : {}
  return {
    ...base,
    ...state,
    users: state.users || {},
    groups: state.groups || {},
    catalog: state.catalog || {},
    activeSpawns: state.activeSpawns || {},
    trades: state.trades || {},
    gifts: state.gifts || {},
    market: state.market || {},
    auctions: state.auctions || {},
    banners: state.banners || {},
    events: state.events || {},
    codes: state.codes || {},
    bans: state.bans || {},
    recentMarket: Array.isArray(state.recentMarket) ? state.recentMarket : [],
    tradeHistory: Array.isArray(state.tradeHistory) ? state.tradeHistory : [],
    global: { ...base.global, ...(state.global || {}) }
  }
}

function readUnlocked() {
  ensureRoot()
  try {
    return normalizeState(JSON.parse(fs.readFileSync(stateFile, 'utf8')))
  } catch {
    return freshState()
  }
}

function writeUnlocked(state) {
  ensureRoot()
  const normalized = normalizeState(state)
  const tmp = `${stateFile}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2))
  fs.renameSync(tmp, stateFile)
}

function clearStaleLock() {
  try {
    const age = Date.now() - fs.statSync(lockFile).mtimeMs
    if (age > LOCK_STALE_MS) fs.rmSync(lockFile, { force: true })
  } catch {}
}

function lock() {
  ensureRoot()
  for (let attempt = 0; attempt < 250; attempt += 1) {
    clearStaleLock()
    try {
      return fs.openSync(lockFile, 'wx')
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      Atomics.wait(waitBuffer, 0, 0, 20)
    }
  }
  throw new Error('El sistema Gacha está ocupado. Intenta nuevamente.')
}

export function withGachaState(handler) {
  const descriptor = lock()
  try {
    const state = readUnlocked()
    const result = handler(state)
    writeUnlocked(state)
    return result
  } finally {
    fs.closeSync(descriptor)
    fs.rmSync(lockFile, { force: true })
  }
}

export function getGachaState() {
  return readUnlocked()
}

export function replaceGachaState(next) {
  const descriptor = lock()
  try {
    writeUnlocked(next)
  } finally {
    fs.closeSync(descriptor)
    fs.rmSync(lockFile, { force: true })
  }
}

export function backupGachaState(label = 'manual') {
  const descriptor = lock()
  try {
    const state = readUnlocked()
    ensureRoot()
    const safe = String(label).replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'manual'
    const file = path.join(backupDir, `${Date.now()}-${safe}.json`)
    fs.writeFileSync(file, JSON.stringify(state, null, 2))
    return file
  } finally {
    fs.closeSync(descriptor)
    fs.rmSync(lockFile, { force: true })
  }
}

export function gachaStatePath() {
  ensureRoot()
  return stateFile
}
