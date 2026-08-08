import config from '../../config.js'
import {
  withGachaState,
  getGachaState,
  backupGachaState,
  gachaStatePath
} from '../lib/gachaStore.js'

const JIKAN = 'https://api.jikan.moe/v4'
const DEFAULT_GROUP = {
  enabled: true,
  autoSpawn: false,
  cooldownSec: 30,
  claimTimeSec: 60,
  autoSpawnEverySec: 900,
  channel: null,
  rules: 'Respeta a los demás jugadores. Las monedas del Gacha son virtuales y no tienen valor real.'
}
const SHOP = {
  ticket: { price: 300, label: '🎟️ Gacha Ticket' },
  reroll_token: { price: 220, label: '🔁 Reroll Token' },
  luck_potion: { price: 700, label: '🍀 Luck Potion' },
  wishlist_booster: { price: 900, label: '💖 Wishlist Booster' },
  double_coins: { price: 1000, label: '🪙 Double Coins' },
  xp_card: { price: 180, label: '📘 XP Card' },
  snack: { price: 120, label: '🍪 Snack' },
  character_gift: { price: 260, label: '🎁 Character Gift' }
}
const ACHIEVEMENTS = {
  first_claim: { title: 'Primer personaje', description: 'Reclama tu primer personaje.', reward: 300 },
  claims_100: { title: 'Coleccionista', description: 'Alcanza 100 claims.', reward: 2500 },
  first_5: { title: 'Brillo dorado', description: 'Consigue un ★★★★★.', reward: 1200 },
  first_6: { title: 'Mítico', description: 'Consigue un ★★★★★★.', reward: 3500 },
  unique_100: { title: 'Archivo viviente', description: 'Consigue 100 personajes distintos.', reward: 5000 },
  rolls_1000: { title: 'Sin descanso', description: 'Realiza 1000 tiradas.', reward: 7000 },
  wishlist_10: { title: 'Soñador', description: 'Ten 10 personajes en wishlist.', reward: 1000 }
}
const TITLES = ['Novato Gacha', 'Coleccionista', 'Cazador de Rarezas', 'Leyenda de Nero']
const BADGES = ['🎴', '⭐', '💎', '👑', '🖤']

const now = () => Date.now()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const clamp = (n, min, max) => Math.max(min, Math.min(max, n))
const random = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const clean = value => String(value ?? '').trim()
const lower = value => clean(value).toLowerCase()
const jidKey = jid => {
  const value = String(jid || '')
  const at = value.indexOf('@')
  if (at === -1) return value.split(':')[0]
  const local = value.slice(0, at).split(':')[0]
  return `${local}${value.slice(at)}`
}
const mention = jid => `@${String(jid || '').split('@')[0].split(':')[0]}`
const money = value => Number(value || 0).toLocaleString('es-PE')
const stars = rarity => '★'.repeat(clamp(Number(rarity) || 1, 1, 6))
const instanceId = () => `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const txId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const prefixOf = ctx => ctx.prefix || config.prefix || '.'

function quotedContext(msg) {
  return msg?.message?.extendedTextMessage?.contextInfo ||
    msg?.message?.imageMessage?.contextInfo ||
    msg?.message?.videoMessage?.contextInfo ||
    msg?.message?.documentMessage?.contextInfo ||
    null
}

function mentionedJids(ctx) {
  const info = quotedContext(ctx.msg)
  return [...new Set([
    ...(info?.mentionedJid || []),
    ...(info?.participant ? [info.participant] : [])
  ].filter(Boolean))]
}

function targetJid(ctx, fallback = null) {
  return mentionedJids(ctx)[0] || fallback
}

function argsWithoutMentions(ctx) {
  return (ctx.args || []).filter(arg => !String(arg).startsWith('@'))
}

async function reply(ctx, text, extra = {}) {
  return ctx.sock.sendMessage(ctx.chat, { text, ...extra }, { quoted: ctx.msg })
}

async function sendCharacter(ctx, character, caption) {
  if (character?.image) {
    try {
      return await ctx.sock.sendMessage(ctx.chat, {
        image: { url: character.image },
        caption
      }, { quoted: ctx.msg })
    } catch {}
  }
  return reply(ctx, caption)
}

function defaultUser() {
  return {
    coins: 1000,
    tickets: 3,
    items: {},
    boosters: {},
    collection: [],
    favorites: [],
    favoriteUid: null,
    wishlist: [],
    teams: { main: [] },
    activeTeam: 'main',
    partnerUid: null,
    profile: {
      bio: '', cardUid: null, title: 'Novato Gacha', badge: '🎴', privacy: 'public'
    },
    notifications: {
      gacha: true, wish: true, trade: true, market: true, event: true
    },
    cooldowns: {},
    pendingSell: null,
    pendingRewards: [],
    claimedAchievements: [],
    titles: ['Novato Gacha'],
    badges: ['🎴'],
    transactions: [],
    expeditions: [],
    stats: {
      rolls: 0, claims: 0, coinsEarned: 0, coinsSpent: 0,
      trades: 0, gifts: 0, battles: 0, wins: 0,
      bestRarity: 0, worstLuck: 0, currentDry: 0
    },
    pity: { five: 0, six: 0 },
    createdAt: now(),
    lastSeenAt: now()
  }
}

function userOf(state, jid) {
  const key = jidKey(jid)
  if (!state.users[key]) state.users[key] = defaultUser()
  const user = state.users[key]
  user.items ||= {}
  user.boosters ||= {}
  user.collection ||= []
  user.favorites ||= []
  user.wishlist ||= []
  user.teams ||= { main: [] }
  user.activeTeam ||= 'main'
  user.notifications ||= defaultUser().notifications
  user.cooldowns ||= {}
  user.pendingRewards ||= []
  user.claimedAchievements ||= []
  user.titles ||= ['Novato Gacha']
  user.badges ||= ['🎴']
  user.transactions ||= []
  user.expeditions ||= []
  user.stats = { ...defaultUser().stats, ...(user.stats || {}) }
  user.pity = { five: 0, six: 0, ...(user.pity || {}) }
  user.profile = { ...defaultUser().profile, ...(user.profile || {}) }
  user.lastSeenAt = now()
  return user
}

function groupOf(state, chat) {
  if (!state.groups[chat]) state.groups[chat] = { ...DEFAULT_GROUP }
  state.groups[chat] = { ...DEFAULT_GROUP, ...(state.groups[chat] || {}) }
  return state.groups[chat]
}

function isPrivileged(ctx) {
  return Boolean(ctx.isOwner || ctx.isSubOwner || ctx.isAdmin)
}

function ownerOnly(ctx) {
  if (!ctx.isOwner) throw new Error('Este comando es exclusivo del Owner.')
}

function adminOnly(ctx) {
  if (!isPrivileged(ctx)) throw new Error('Este comando requiere Admin, SubOwner u Owner.')
}

function ensurePlayerAllowed(state, ctx) {
  const key = jidKey(ctx.sender)
  if (state.bans[key]) throw new Error(`Estás bloqueado del Gacha. Motivo: ${state.bans[key].reason || 'sin motivo'}`)
  const group = groupOf(state, ctx.chat)
  if (String(ctx.chat).endsWith('@g.us') && !group.enabled && !isPrivileged(ctx)) {
    throw new Error(`El Gacha está desactivado en este grupo. Usa ${prefixOf(ctx)}gacha on como admin.`)
  }
  return group
}

function addTransaction(user, type, amount, note = '') {
  user.transactions.unshift({ id: txId('tx'), type, amount, note, at: now() })
  user.transactions = user.transactions.slice(0, 50)
}

function addCoins(user, amount, note = '') {
  const n = Math.max(0, Math.floor(Number(amount) || 0))
  user.coins += n
  user.stats.coinsEarned += n
  addTransaction(user, 'credit', n, note)
  return n
}

function spendCoins(user, amount, note = '') {
  const n = Math.max(0, Math.floor(Number(amount) || 0))
  if (user.coins < n) throw new Error(`Necesitas ${money(n)} monedas.`)
  user.coins -= n
  user.stats.coinsSpent += n
  addTransaction(user, 'debit', n, note)
  return n
}

function activeBoost(user, name) {
  const until = Number(user.boosters?.[name] || 0)
  return until > now()
}

function cleanBoosters(user) {
  for (const [name, until] of Object.entries(user.boosters || {})) {
    if (Number(until) <= now()) delete user.boosters[name]
  }
}

function rarityFromFavorites(favorites = 0) {
  const f = Number(favorites) || 0
  if (f >= 100000) return 6
  if (f >= 40000) return 5
  if (f >= 12000) return 4
  if (f >= 3000) return 3
  if (f >= 500) return 2
  return 1
}

function valueFromCharacter(rarity, favorites = 0) {
  const base = [0, 80, 180, 450, 1100, 3200, 9000][rarity] || 80
  return base + Math.min(5000, Math.floor((Number(favorites) || 0) / 20))
}

function normalizeCharacter(raw = {}, forced = {}) {
  const id = String(forced.id || raw.mal_id || raw.id || `custom-${Date.now()}`)
  const favorites = Number(forced.favorites ?? raw.favorites ?? 0) || 0
  const rarity = clamp(Number(forced.rarity || raw.rarity || rarityFromFavorites(favorites)), 1, 6)
  const anime = raw.anime || raw.animeography || []
  const series = forced.series || raw.series ||
    anime?.[0]?.anime?.title || anime?.[0]?.title || anime?.[0]?.name || 'Serie no registrada'
  const image = forced.image || raw.image || raw.images?.jpg?.large_image_url || raw.images?.jpg?.image_url || raw.images?.webp?.large_image_url || ''
  return {
    id,
    name: clean(forced.name || raw.name || `Personaje ${id}`),
    series: clean(series),
    image: clean(image),
    favorites,
    rarity,
    value: Math.max(1, Number(forced.value || raw.value || valueFromCharacter(rarity, favorites))),
    aliases: Array.isArray(forced.aliases || raw.nicknames) ? [...(forced.aliases || raw.nicknames)] : [],
    source: forced.source || raw.source || 'Jikan/MAL',
    limited: Boolean(forced.limited || raw.limited),
    event: forced.event || raw.event || null,
    addedAt: Number(forced.addedAt || raw.addedAt || now())
  }
}

async function fetchJson(url, timeout = 12000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'NeroBot-Gacha/1.0' }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchRandomCharacter() {
  const json = await fetchJson(`${JIKAN}/random/characters`)
  if (!json?.data) throw new Error('La API de personajes no devolvió resultados.')
  return normalizeCharacter(json.data)
}

async function searchCharactersApi(query) {
  const json = await fetchJson(`${JIKAN}/characters?q=${encodeURIComponent(query)}&limit=10`)
  return (json?.data || []).map(item => normalizeCharacter(item))
}

function catalogMatch(state, query) {
  const q = lower(query)
  if (!q) return null
  if (state.catalog[q]) return state.catalog[q]
  return Object.values(state.catalog).find(char =>
    lower(char.name) === q ||
    lower(char.name).includes(q) ||
    (char.aliases || []).some(alias => lower(alias).includes(q))
  ) || null
}

function catalogMatches(state, query) {
  const q = lower(query)
  return Object.values(state.catalog).filter(char =>
    !q || lower(char.name).includes(q) || lower(char.series).includes(q)
  )
}

function itemByArg(user, state, arg) {
  const q = lower(arg)
  if (!q) return null
  return user.collection.find(item => lower(item.uid) === q) ||
    user.collection.find(item => {
      const char = state.catalog[item.charId]
      return char && lower(char.name) === q
    }) ||
    user.collection.find(item => {
      const char = state.catalog[item.charId]
      return char && lower(char.name).includes(q)
    }) || null
}

function charForItem(state, item) {
  return item ? state.catalog[item.charId] || null : null
}

function ownedCount(state, charId) {
  return Object.values(state.users).reduce((sum, user) =>
    sum + (user.collection || []).filter(item => item.charId === charId).length, 0)
}

function ownersFor(state, charId) {
  const rows = []
  for (const [jid, user] of Object.entries(state.users)) {
    const count = (user.collection || []).filter(item => item.charId === charId).length
    if (count) rows.push({ jid, count })
  }
  return rows
}

function collectionValue(state, user) {
  return (user.collection || []).reduce((sum, item) => {
    const char = charForItem(state, item)
    return sum + (char?.value || 0) * Math.max(1, item.level || 1)
  }, 0)
}

function powerOf(state, item) {
  const char = charForItem(state, item)
  if (!char) return 0
  return Math.floor((char.value / 10) + (char.rarity * 100) + ((item.level || 1) * 25) + ((item.evolution || 0) * 250) + ((item.ascension || 0) * 500))
}

function userTeam(user) {
  const name = user.activeTeam || 'main'
  user.teams[name] ||= []
  return user.teams[name]
}

function teamPower(state, user) {
  const ids = userTeam(user)
  return ids.reduce((sum, id) => sum + powerOf(state, user.collection.find(item => item.uid === id)), 0)
}

function formatCharacter(char, item = null) {
  const lines = [
    `🎴 *${char.name}*`,
    `📺 Serie: ${char.series}`,
    `✨ Rareza: ${stars(item?.rarity || char.rarity)}`,
    `💰 Valor: ${money(char.value)}`,
    `🆔 ID: ${char.id}`
  ]
  if (item) {
    lines.push(`🔖 Copia: ${item.uid}`)
    lines.push(`📈 Nivel: ${item.level || 1}`)
    lines.push(`💞 Afinidad: ${item.affinity || 0}`)
    if (item.nickname) lines.push(`🏷️ Apodo: ${item.nickname}`)
    if (item.locked) lines.push('🔒 Protegido')
  }
  if (char.limited) lines.push('💎 LIMITED')
  if (char.event) lines.push(`🎊 Evento: ${char.event}`)
  return lines.join('\n')
}

function cooldownLeft(user, key, seconds) {
  const last = Number(user.cooldowns?.[key] || 0)
  return Math.max(0, (last + seconds * 1000) - now())
}

function useCooldown(user, key) {
  user.cooldowns[key] = now()
}

function cleanupExpired(state) {
  const t = now()
  for (const [chat, spawn] of Object.entries(state.activeSpawns)) {
    if (spawn.expiresAt <= t) delete state.activeSpawns[chat]
  }
  for (const [id, auction] of Object.entries(state.auctions)) {
    if (auction.status !== 'active' || auction.endsAt > t) continue
    const seller = userOf(state, auction.seller)
    const item = seller.collection.find(x => x.uid === auction.itemUid)
    const bids = [...(auction.bids || [])].sort((a, b) => b.amount - a.amount)
    let settled = false
    for (const bid of bids) {
      const buyer = userOf(state, bid.jid)
      if (buyer.coins < bid.amount || !item) continue
      buyer.coins -= bid.amount
      seller.coins += bid.amount
      seller.collection = seller.collection.filter(x => x.uid !== item.uid)
      item.lockedByAuction = null
      buyer.collection.push(item)
      auction.status = 'sold'
      auction.winner = bid.jid
      auction.finalPrice = bid.amount
      state.recentMarket.unshift({ type: 'auction', charId: item.charId, price: bid.amount, at: t })
      settled = true
      break
    }
    if (!settled) {
      auction.status = 'ended'
      if (item) item.lockedByAuction = null
    }
  }
}

function achievementStatus(state, user) {
  const unique = new Set(user.collection.map(x => x.charId)).size
  const has5 = user.collection.some(x => (x.rarity || state.catalog[x.charId]?.rarity || 0) >= 5)
  const has6 = user.collection.some(x => (x.rarity || state.catalog[x.charId]?.rarity || 0) >= 6)
  return {
    first_claim: user.stats.claims >= 1,
    claims_100: user.stats.claims >= 100,
    first_5: has5,
    first_6: has6,
    unique_100: unique >= 100,
    rolls_1000: user.stats.rolls >= 1000,
    wishlist_10: user.wishlist.length >= 10
  }
}

function maybeUnlockCosmetics(state, user) {
  if (user.stats.claims >= 25 && !user.titles.includes('Coleccionista')) user.titles.push('Coleccionista')
  if (user.stats.bestRarity >= 5 && !user.titles.includes('Cazador de Rarezas')) user.titles.push('Cazador de Rarezas')
  if (user.stats.claims >= 250 && !user.titles.includes('Leyenda de Nero')) user.titles.push('Leyenda de Nero')
  if (user.stats.bestRarity >= 4 && !user.badges.includes('⭐')) user.badges.push('⭐')
  if (user.stats.bestRarity >= 5 && !user.badges.includes('💎')) user.badges.push('💎')
  if (user.stats.bestRarity >= 6 && !user.badges.includes('👑')) user.badges.push('👑')
  if (user.stats.claims >= 500 && !user.badges.includes('🖤')) user.badges.push('🖤')
}

async function getRollCharacter(state, user) {
  cleanBoosters(user)
  const guarantee6 = user.pity.six >= 149
  const guarantee5 = user.pity.five >= 69
  const cached = Object.values(state.catalog)
  if (guarantee6) {
    const choices = cached.filter(c => c.rarity >= 6)
    if (choices.length) return choices[random(0, choices.length - 1)]
  }
  if (guarantee5) {
    const choices = cached.filter(c => c.rarity >= 5)
    if (choices.length) return choices[random(0, choices.length - 1)]
  }
  if (cached.length >= 30 && Math.random() < 0.65) {
    const weighted = cached.filter(c => {
      const r = Math.random() * 100
      if (c.rarity === 6) return r < 1
      if (c.rarity === 5) return r < 4
      if (c.rarity === 4) return r < 12
      if (c.rarity === 3) return r < 30
      if (c.rarity === 2) return r < 65
      return true
    })
    const pool = weighted.length ? weighted : cached
    return pool[random(0, pool.length - 1)]
  }
  let char = await fetchRandomCharacter()
  if (activeBoost(user, 'luck_potion')) char.rarity = clamp(char.rarity + 1, 1, 6)
  if (guarantee6) char.rarity = 6
  else if (guarantee5) char.rarity = Math.max(5, char.rarity)
  char.value = valueFromCharacter(char.rarity, char.favorites)
  return char
}

async function rollHandler(ctx) {
  const snapshot = getGachaState()
  cleanupExpired(snapshot)
  const group = groupOf(snapshot, ctx.chat)
  if (String(ctx.chat).endsWith('@g.us') && !group.enabled && !isPrivileged(ctx)) {
    throw new Error('El Gacha está desactivado en este grupo.')
  }
  if (snapshot.bans[jidKey(ctx.sender)]) throw new Error('Estás bloqueado del Gacha.')
  const existing = snapshot.activeSpawns[ctx.chat]
  if (existing && existing.expiresAt > now()) {
    const char = snapshot.catalog[existing.charId]
    throw new Error(`Ya hay un personaje activo: ${char?.name || existing.charId}. Quedan ${Math.ceil((existing.expiresAt - now()) / 1000)}s.`)
  }
  const last = Number(group.lastRollAt || 0)
  const left = (last + group.cooldownSec * 1000) - now()
  if (left > 0) throw new Error(`Espera ${Math.ceil(left / 1000)}s para otra tirada.`)

  const snapshotUser = userOf(snapshot, ctx.sender)
  const char = await getRollCharacter(snapshot, snapshotUser)

  const result = withGachaState(state => {
    cleanupExpired(state)
    const g = ensurePlayerAllowed(state, ctx)
    const active = state.activeSpawns[ctx.chat]
    if (active && active.expiresAt > now()) throw new Error('Otro personaje apareció antes de completar tu tirada.')
    const again = (Number(g.lastRollAt || 0) + g.cooldownSec * 1000) - now()
    if (again > 0) throw new Error(`Espera ${Math.ceil(again / 1000)}s para otra tirada.`)
    const user = userOf(state, ctx.sender)
    state.catalog[char.id] = normalizeCharacter(char)
    user.stats.rolls += 1
    user.pity.five += 1
    user.pity.six += 1
    state.global.rolls += 1
    g.lastRollAt = now()
    g.lastSpawn = char.id
    state.activeSpawns[ctx.chat] = {
      id: txId('spawn'), charId: char.id, spawnedBy: jidKey(ctx.sender),
      createdAt: now(), expiresAt: now() + g.claimTimeSec * 1000
    }
    return { char: state.catalog[char.id], claimTimeSec: g.claimTimeSec }
  })

  const wishers = []
  const state = getGachaState()
  for (const [jid, user] of Object.entries(state.users)) {
    if (user.notifications?.wish !== false && user.wishlist?.includes(result.char.id)) wishers.push(jid)
  }
  const wishLine = wishers.length ? `\n💖 Wishlist: ${wishers.slice(0, 5).map(mention).join(', ')}` : ''
  await sendCharacter(ctx, result.char, [
    '✨ *APARECIÓ UN PERSONAJE* ✨', '',
    `🎴 ${result.char.name}`,
    `📺 ${result.char.series}`,
    `⭐ ${stars(result.char.rarity)}`,
    `💰 ${money(result.char.value)} monedas`,
    `🆔 ${result.char.id}`,
    wishLine,
    '',
    `Usa *${prefixOf(ctx)}claim* o *${prefixOf(ctx)}c*`,
    `⏳ Tiempo: ${result.claimTimeSec}s`
  ].filter(Boolean).join('\n'))
}

async function claimHandler(ctx) {
  const result = withGachaState(state => {
    cleanupExpired(state)
    ensurePlayerAllowed(state, ctx)
    const spawn = state.activeSpawns[ctx.chat]
    if (!spawn) throw new Error('No hay ningún personaje activo para reclamar.')
    if (spawn.expiresAt <= now()) {
      delete state.activeSpawns[ctx.chat]
      throw new Error('El personaje ya escapó.')
    }
    const char = state.catalog[spawn.charId]
    if (!char) throw new Error('No se encontró el personaje del spawn.')
    const user = userOf(state, ctx.sender)
    const item = {
      uid: instanceId(), charId: char.id, rarity: char.rarity,
      obtainedAt: now(), source: 'claim', level: 1, xp: 0,
      affinity: 0, nickname: '', locked: false, evolution: 0, ascension: 0
    }
    user.collection.push(item)
    user.stats.claims += 1
    user.stats.bestRarity = Math.max(user.stats.bestRarity, char.rarity)
    if (char.rarity >= 5) user.pity.five = 0
    if (char.rarity >= 6) user.pity.six = 0
    if (char.rarity >= 4) user.stats.currentDry = 0
    else {
      user.stats.currentDry += 1
      user.stats.worstLuck = Math.max(user.stats.worstLuck, user.stats.currentDry)
    }
    state.global.claims += 1
    delete state.activeSpawns[ctx.chat]
    maybeUnlockCosmetics(state, user)
    return { char, item, copies: ownedCount(state, char.id) }
  })
  await sendCharacter(ctx, result.char, `✅ ${mention(ctx.sender)} reclamó a *${result.char.name}*\n${stars(result.item.rarity)} • Copia ${result.item.uid}\n🌐 Copias globales: ${result.copies}`)
}

async function rerollHandler(ctx) {
  const snapshot = getGachaState()
  const active = snapshot.activeSpawns[ctx.chat]
  if (!active || active.expiresAt <= now()) throw new Error('No hay aparición activa para rerollear.')
  const user = userOf(snapshot, ctx.sender)
  const canToken = Number(user.items?.reroll_token || 0) > 0
  if (!canToken && user.coins < 250) throw new Error('Necesitas un Reroll Token o 250 monedas.')
  const char = await getRollCharacter(snapshot, user)
  const result = withGachaState(state => {
    ensurePlayerAllowed(state, ctx)
    const spawn = state.activeSpawns[ctx.chat]
    if (!spawn || spawn.expiresAt <= now()) throw new Error('La aparición ya no está disponible.')
    const liveUser = userOf(state, ctx.sender)
    if ((liveUser.items.reroll_token || 0) > 0) liveUser.items.reroll_token -= 1
    else spendCoins(liveUser, 250, 'Reroll')
    state.catalog[char.id] = normalizeCharacter(char)
    spawn.charId = char.id
    spawn.createdAt = now()
    spawn.expiresAt = now() + groupOf(state, ctx.chat).claimTimeSec * 1000
    return state.catalog[char.id]
  })
  await sendCharacter(ctx, result, `🔁 *REROLL*\n\n${formatCharacter(result)}\n\nUsa ${prefixOf(ctx)}claim para reclamar.`)
}

async function skipHandler(ctx) {
  const result = withGachaState(state => {
    const spawn = state.activeSpawns[ctx.chat]
    if (!spawn) throw new Error('No hay aparición activa.')
    if (jidKey(ctx.sender) !== spawn.spawnedBy && !isPrivileged(ctx)) throw new Error('Solo quien hizo la tirada o un admin puede descartarla.')
    const char = state.catalog[spawn.charId]
    delete state.activeSpawns[ctx.chat]
    return char
  })
  await reply(ctx, `⏭️ ${result?.name || 'El personaje'} fue descartado.`)
}

async function lastSpawnHandler(ctx) {
  const state = getGachaState()
  const group = groupOf(state, ctx.chat)
  const char = state.catalog[group.lastSpawn]
  if (!char) throw new Error('Todavía no hay una aparición registrada en este grupo.')
  await sendCharacter(ctx, char, `🕘 *Última aparición*\n\n${formatCharacter(char)}`)
}

async function characterHandler(ctx) {
  const query = argsWithoutMentions(ctx).join(' ')
  if (!query) throw new Error(`Uso: ${prefixOf(ctx)}character <nombre/id>`)
  let state = getGachaState()
  let char = catalogMatch(state, query)
  if (!char) {
    const found = await searchCharactersApi(query)
    if (!found.length) throw new Error('No encontré ese personaje.')
    withGachaState(s => { for (const c of found) s.catalog[c.id] = c })
    char = found[0]
    state = getGachaState()
  }
  await sendCharacter(ctx, char, `${formatCharacter(char)}\n🌐 Copias: ${ownedCount(state, char.id)}\n👥 Owners: ${ownersFor(state, char.id).length}`)
}

async function lookupHandler(ctx) {
  const query = argsWithoutMentions(ctx).join(' ')
  if (!query) throw new Error(`Uso: ${prefixOf(ctx)}lookup <nombre>`)
  let results = catalogMatches(getGachaState(), query).slice(0, 10)
  if (results.length < 3) {
    const api = await searchCharactersApi(query)
    withGachaState(state => { for (const char of api) state.catalog[char.id] = char })
    results = [...results, ...api].filter((v, i, arr) => arr.findIndex(x => x.id === v.id) === i).slice(0, 10)
  }
  if (!results.length) throw new Error('Sin resultados.')
  await reply(ctx, ['🔎 *Resultados*', '', ...results.map((c, i) => `${i + 1}. ${stars(c.rarity)} *${c.name}* — ${c.series} — ID ${c.id}`)].join('\n'))
}

async function seriesHandler(ctx) {
  const query = argsWithoutMentions(ctx).join(' ')
  if (!query) throw new Error(`Uso: ${prefixOf(ctx)}series <anime>`)
  const rows = Object.values(getGachaState().catalog).filter(c => lower(c.series).includes(lower(query))).slice(0, 30)
  if (!rows.length) throw new Error('Aún no hay personajes de esa serie en el catálogo local. Usa .lookup para importarlos.')
  await reply(ctx, [`📺 *${query}*`, '', ...rows.map(c => `${stars(c.rarity)} ${c.name} • ${c.id}`)].join('\n'))
}

async function rarityHandler(ctx) {
  const n = clamp(Number(ctx.args?.[0]) || 0, 1, 6)
  const rows = Object.values(getGachaState().catalog).filter(c => c.rarity === n).slice(0, 40)
  if (!rows.length) throw new Error(`No hay personajes ${stars(n)} todavía.`)
  await reply(ctx, [`⭐ *Rareza ${stars(n)}*`, '', ...rows.map(c => `${c.name} • ${c.series} • ${c.id}`)].join('\n'))
}

async function randomCharHandler(ctx) {
  const state = getGachaState()
  const list = Object.values(state.catalog)
  let char
  if (list.length) char = list[random(0, list.length - 1)]
  else {
    char = await fetchRandomCharacter()
    withGachaState(s => { s.catalog[char.id] = char })
  }
  await sendCharacter(ctx, char, `🎲 *Personaje aleatorio (no reclamable)*\n\n${formatCharacter(char)}`)
}

async function compareHandler(ctx) {
  const [a, b] = argsWithoutMentions(ctx)
  if (!a || !b) throw new Error(`Uso: ${prefixOf(ctx)}compare <id1> <id2>`)
  const state = getGachaState()
  const ca = catalogMatch(state, a)
  const cb = catalogMatch(state, b)
  if (!ca || !cb) throw new Error('No encontré uno de los personajes.')
  const winner = ca.value === cb.value ? 'Empate' : (ca.value > cb.value ? ca.name : cb.name)
  await reply(ctx, `⚖️ *Comparación*\n\n${stars(ca.rarity)} ${ca.name}: ${money(ca.value)}\n${stars(cb.rarity)} ${cb.name}: ${money(cb.value)}\n\n🏆 ${winner}`)
}

async function valueHandler(ctx) {
  const q = argsWithoutMentions(ctx).join(' ')
  const state = getGachaState()
  const char = catalogMatch(state, q)
  if (!char) throw new Error('Personaje no encontrado.')
  await reply(ctx, `💰 *${char.name}* vale ${money(char.value)} monedas.\nRareza: ${stars(char.rarity)}`)
}

async function ownerOfHandler(ctx) {
  const q = argsWithoutMentions(ctx).join(' ')
  const state = getGachaState()
  const char = catalogMatch(state, q)
  if (!char) throw new Error('Personaje no encontrado.')
  const rows = ownersFor(state, char.id)
  await reply(ctx, [`👥 *Owners de ${char.name}*`, `Copias: ${ownedCount(state, char.id)}`, '', ...(rows.slice(0, 30).map(x => `${mention(x.jid)} ×${x.count}`) || ['Nadie'])].join('\n'), { mentions: rows.map(x => x.jid) })
}

async function copiesHandler(ctx) {
  const q = argsWithoutMentions(ctx).join(' ')
  const state = getGachaState()
  const char = catalogMatch(state, q)
  if (!char) throw new Error('Personaje no encontrado.')
  await reply(ctx, `🌐 Hay *${ownedCount(state, char.id)}* copias de *${char.name}* en Nero.`)
}

async function gachaIdHandler(ctx) {
  const q = argsWithoutMentions(ctx).join(' ')
  const char = catalogMatch(getGachaState(), q)
  if (!char) throw new Error('Personaje no encontrado.')
  await reply(ctx, `🆔 ${char.name}: *${char.id}*`)
}

function collectionTarget(ctx) {
  return targetJid(ctx, ctx.sender)
}

async function haremHandler(ctx) {
  const target = collectionTarget(ctx)
  const state = getGachaState()
  const user = userOf(state, target)
  const sorted = [...user.collection].sort((a, b) => (charForItem(state, b)?.rarity || 0) - (charForItem(state, a)?.rarity || 0))
  const lines = sorted.slice(0, 40).map((item, i) => {
    const char = charForItem(state, item)
    return `${i + 1}. ${stars(item.rarity || char?.rarity)} ${item.locked ? '🔒 ' : ''}${char?.name || item.charId} • ${item.uid}`
  })
  await reply(ctx, [`💞 *Harem de ${mention(target)}*`, `Personajes: ${user.collection.length}`, `Valor: ${money(collectionValue(state, user))}`, '', ...(lines.length ? lines : ['Colección vacía.'])].join('\n'), { mentions: [target] })
}

async function collectionSummaryHandler(ctx, mode) {
  const target = collectionTarget(ctx)
  const state = getGachaState()
  const user = userOf(state, target)
  let list = [...user.collection]
  if (mode === 'duplicates') {
    const counts = {}
    for (const item of list) counts[item.charId] = (counts[item.charId] || 0) + 1
    list = list.filter(item => counts[item.charId] > 1)
  } else if (mode === 'recent') list.sort((a, b) => b.obtainedAt - a.obtainedAt)
  else if (mode === 'oldest') list.sort((a, b) => a.obtainedAt - b.obtainedAt)
  else if (mode === 'best') list.sort((a, b) => (charForItem(state, b)?.value || 0) - (charForItem(state, a)?.value || 0))
  else if (mode === 'rarest') list.sort((a, b) => (b.rarity || 0) - (a.rarity || 0))
  const lines = list.slice(0, 40).map(item => {
    const char = charForItem(state, item)
    return `${stars(item.rarity || char?.rarity)} ${char?.name || item.charId} • ${item.uid}`
  })
  await reply(ctx, [`🗂️ *${mode.toUpperCase()}*`, `Usuario: ${mention(target)}`, '', ...(lines.length ? lines : ['Sin resultados.'])].join('\n'), { mentions: [target] })
}

async function raritiesSummaryHandler(ctx) {
  const target = collectionTarget(ctx)
  const state = getGachaState()
  const user = userOf(state, target)
  const counts = Array(7).fill(0)
  for (const item of user.collection) counts[item.rarity || charForItem(state, item)?.rarity || 1] += 1
  await reply(ctx, [`⭐ *Rarezas de ${mention(target)}*`, '', ...[1,2,3,4,5,6].map(n => `${stars(n)}: ${counts[n]}`)].join('\n'), { mentions: [target] })
}

async function collectionValueHandler(ctx) {
  const target = collectionTarget(ctx)
  const state = getGachaState()
  const user = userOf(state, target)
  await reply(ctx, `💎 ${mention(target)} tiene una colección valorada en *${money(collectionValue(state, user))}* monedas.`, { mentions: [target] })
}

async function completionHandler(ctx) {
  const target = collectionTarget(ctx)
  const state = getGachaState()
  const user = userOf(state, target)
  const total = Object.keys(state.catalog).length
  const unique = new Set(user.collection.map(x => x.charId)).size
  const pct = total ? ((unique / total) * 100).toFixed(1) : '0.0'
  await reply(ctx, `📚 *Completado*\n${mention(target)}: ${unique}/${total} personajes únicos (${pct}%).`, { mentions: [target] })
}

async function seriesCompletionHandler(ctx) {
  const query = argsWithoutMentions(ctx).join(' ')
  if (!query) throw new Error(`Uso: ${prefixOf(ctx)}seriescompletion <anime>`)
  const state = getGachaState()
  const user = userOf(state, ctx.sender)
  const chars = Object.values(state.catalog).filter(c => lower(c.series).includes(lower(query)))
  if (!chars.length) throw new Error('No hay personajes de esa serie en el catálogo.')
  const owned = new Set(user.collection.map(x => x.charId))
  const got = chars.filter(c => owned.has(c.id)).length
  await reply(ctx, `📺 *${query}*\nCompletado: ${got}/${chars.length} (${((got/chars.length)*100).toFixed(1)}%).`)
}

async function favoriteHandler(ctx, action) {
  const arg = argsWithoutMentions(ctx).join(' ')
  const result = withGachaState(state => {
    const user = userOf(state, ctx.sender)
    const item = itemByArg(user, state, arg)
    if (!item) throw new Error('No encontré ese personaje en tu colección.')
    if (action === 'fav') {
      if (!user.favorites.includes(item.uid)) user.favorites.push(item.uid)
    } else if (action === 'unfav') user.favorites = user.favorites.filter(x => x !== item.uid)
    else if (action === 'setfavorite') {
      user.favoriteUid = item.uid
      if (!user.favorites.includes(item.uid)) user.favorites.push(item.uid)
    } else if (action === 'lock') item.locked = true
    else if (action === 'unlock') item.locked = false
    return { item, char: charForItem(state, item) }
  })
  await reply(ctx, `✅ ${action}: *${result.char?.name || result.item.charId}* (${result.item.uid})`)
}

async function favsHandler(ctx, locked = false) {
  const state = getGachaState()
  const user = userOf(state, ctx.sender)
  const list = locked ? user.collection.filter(x => x.locked) : user.collection.filter(x => user.favorites.includes(x.uid))
  await reply(ctx, [`${locked ? '🔒 *Protegidos*' : '❤️ *Favoritos*'}`, '', ...(list.length ? list.map(item => `${charForItem(state, item)?.name || item.charId} • ${item.uid}`) : ['Vacío.'])].join('\n'))
}

async function favoriteCurrentHandler(ctx) {
  const state = getGachaState()
  const user = userOf(state, ctx.sender)
  const item = user.collection.find(x => x.uid === user.favoriteUid)
  if (!item) throw new Error('No tienes personaje principal. Usa .setfavorite <id>.')
  const char = charForItem(state, item)
  await sendCharacter(ctx, char, `❤️ *Personaje principal*\n\n${formatCharacter(char, item)}`)
}

async function wishHandler(ctx, remove = false) {
  const query = argsWithoutMentions(ctx).join(' ')
  if (!query) throw new Error(`Uso: ${prefixOf(ctx)}${remove ? 'unwish' : 'wish'} <personaje>`)
  let state = getGachaState()
  let char = catalogMatch(state, query)
  if (!char && !remove) {
    const results = await searchCharactersApi(query)
    if (!results.length) throw new Error('No encontré ese personaje.')
    char = results[0]
    withGachaState(s => { s.catalog[char.id] = char })
  }
  const result = withGachaState(s => {
    const user = userOf(s, ctx.sender)
    const live = char || catalogMatch(s, query)
    if (!live) throw new Error('Personaje no encontrado.')
    if (remove) user.wishlist = user.wishlist.filter(x => x !== live.id)
    else if (!user.wishlist.includes(live.id)) user.wishlist.push(live.id)
    return live
  })
  await reply(ctx, `${remove ? '💔 Quitado' : '💖 Añadido'}: *${result.name}*`)
}

async function wishlistHandler(ctx) {
  const target = collectionTarget(ctx)
  const state = getGachaState()
  const user = userOf(state, target)
  const chars = user.wishlist.map(id => state.catalog[id]).filter(Boolean)
  await reply(ctx, [`💖 *Wishlist de ${mention(target)}*`, '', ...(chars.length ? chars.map(c => `${stars(c.rarity)} ${c.name} • ${c.id}`) : ['Vacía.'])].join('\n'), { mentions: [target] })
}

async function wishClearHandler(ctx) {
  withGachaState(state => { userOf(state, ctx.sender).wishlist = [] })
  await reply(ctx, '✅ Wishlist vaciada.')
}

async function wishMatchHandler(ctx) {
  const state = getGachaState()
  const user = userOf(state, ctx.sender)
  const matches = []
  for (const wanted of user.wishlist) {
    const char = state.catalog[wanted]
    for (const [jid, other] of Object.entries(state.users)) {
      if (jid === jidKey(ctx.sender)) continue
      if ((other.collection || []).some(item => item.charId === wanted)) matches.push(`${char?.name || wanted}: ${mention(jid)}`)
    }
  }
  await reply(ctx, [`🤝 *Wish matches*`, '', ...(matches.length ? matches.slice(0, 40) : ['No encontré coincidencias.'])].join('\n'))
}

async function wishSpawnHandler(ctx) {
  const state = getGachaState()
  const user = userOf(state, ctx.sender)
  const spawn = state.activeSpawns[ctx.chat]
  if (!spawn) throw new Error('No hay spawn activo.')
  const char = state.catalog[spawn.charId]
  await reply(ctx, user.wishlist.includes(spawn.charId) ? `💖 ¡${char?.name} está en tu wishlist!` : `ℹ️ ${char?.name || spawn.charId} no está en tu wishlist.`)
}

async function balanceHandler(ctx) {
  const target = collectionTarget(ctx)
  const state = getGachaState()
  const user = userOf(state, target)
  await reply(ctx, `🪙 *Balance de ${mention(target)}*\nMonedas: ${money(user.coins)}\nTickets: ${user.tickets}\nPatrimonio: ${money(user.coins + collectionValue(state, user))}`, { mentions: [target] })
}

async function timedReward(ctx, key, ms, amount, label) {
  const result = withGachaState(state => {
    ensurePlayerAllowed(state, ctx)
    const user = userOf(state, ctx.sender)
    const last = Number(user.cooldowns[key] || 0)
    const left = last + ms - now()
    if (left > 0) throw new Error(`Tu ${label} estará disponible en ${Math.ceil(left / 60000)} min.`)
    let reward = amount
    if (activeBoost(user, 'double_coins')) reward *= 2
    addCoins(user, reward, label)
    user.cooldowns[key] = now()
    return reward
  })
  await reply(ctx, `🎁 ${label}: recibiste *${money(result)}* monedas.`)
}

async function workHandler(ctx, job = false) {
  const result = withGachaState(state => {
    ensurePlayerAllowed(state, ctx)
    const user = userOf(state, ctx.sender)
    const key = job ? 'gachajob' : 'work'
    const sec = job ? 2700 : 1800
    const left = cooldownLeft(user, key, sec)
    if (left > 0) throw new Error(`Vuelve en ${Math.ceil(left / 60000)} min.`)
    let reward = job ? random(150, 400) : random(80, 250)
    if (activeBoost(user, 'double_coins')) reward *= 2
    addCoins(user, reward, job ? 'Gacha Job' : 'Trabajo')
    useCooldown(user, key)
    return reward
  })
  await reply(ctx, `${job ? '🧑‍💻 Gacha Job' : '🛠️ Trabajo'} completado: +${money(result)} monedas.`)
}

async function rewardsHandler(ctx, claim = false) {
  const result = withGachaState(state => {
    const user = userOf(state, ctx.sender)
    if (!claim) return { list: [...user.pendingRewards], amount: 0 }
    const amount = user.pendingRewards.reduce((sum, r) => sum + Number(r.coins || 0), 0)
    if (!amount) throw new Error('No tienes recompensas pendientes.')
    addCoins(user, amount, 'Recompensas pendientes')
    user.pendingRewards = []
    return { list: [], amount }
  })
  if (claim) await reply(ctx, `🎁 Reclamaste ${money(result.amount)} monedas.`)
  else await reply(ctx, [`🎁 *Recompensas pendientes*`, '', ...(result.list.length ? result.list.map(r => `• ${r.label}: ${money(r.coins)} monedas`) : ['Ninguna.'])].join('\n'))
}

async function transactionsHandler(ctx) {
  const state = getGachaState()
  const user = userOf(state, ctx.sender)
  await reply(ctx, ['📒 *Últimos movimientos*', '', ...(user.transactions.slice(0, 20).map(tx => `${tx.type === 'credit' ? '➕' : '➖'} ${money(tx.amount)} • ${tx.note}`) || ['Sin movimientos.'])].join('\n'))
}

async function payHandler(ctx) {
  const target = targetJid(ctx)
  const amount = Number(argsWithoutMentions(ctx)[0])
  if (!target || !Number.isFinite(amount) || amount <= 0) throw new Error(`Uso: ${prefixOf(ctx)}pay @usuario <cantidad>`)
  if (jidKey(target) === jidKey(ctx.sender)) throw new Error('No puedes pagarte a ti mismo.')
  const sent = withGachaState(state => {
    const from = userOf(state, ctx.sender)
    const to = userOf(state, target)
    spendCoins(from, amount, `Pago a ${jidKey(target)}`)
    addCoins(to, amount, `Pago de ${jidKey(ctx.sender)}`)
    return Math.floor(amount)
  })
  await reply(ctx, `💸 ${mention(ctx.sender)} envió ${money(sent)} monedas a ${mention(target)}.`, { mentions: [ctx.sender, target] })
}

function topUsers(state, metric, limit = 10) {
  return Object.entries(state.users)
    .map(([jid, user]) => ({ jid, user, value: metric(user, jid) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
}

async function richHandler(ctx) {
  const state = getGachaState()
  const rows = topUsers(state, u => u.coins)
  await reply(ctx, ['💰 *Top monedas*', '', ...rows.map((r, i) => `${i + 1}. ${mention(r.jid)} — ${money(r.value)}`)].join('\n'), { mentions: rows.map(r => r.jid) })
}

async function ticketsHandler(ctx) {
  const state = getGachaState()
  const user = userOf(state, ctx.sender)
  await reply(ctx, `🎟️ Tickets: *${user.tickets}*`)
}

async function ticketShopHandler(ctx) {
  await reply(ctx, ['🛒 *Tienda Gacha*', '', ...Object.entries(SHOP).map(([id, it]) => `• ${it.label} — ${money(it.price)} — ${prefixOf(ctx)}use/${id}`), '', `Compra tickets: ${prefixOf(ctx)}buyticket <cantidad>`, `Compra objetos: ${prefixOf(ctx)}use buy <objeto>`].join('\n'))
}

async function buyTicketHandler(ctx) {
  const qty = clamp(Number(ctx.args?.[0]) || 1, 1, 100)
  const result = withGachaState(state => {
    const user = userOf(state, ctx.sender)
    const cost = qty * SHOP.ticket.price
    spendCoins(user, cost, `Compra ${qty} ticket(s)`)
    user.tickets += qty
    return { qty, cost }
  })
  await reply(ctx, `🎟️ Compraste ${result.qty} ticket(s) por ${money(result.cost)} monedas.`)
}

async function useItemHandler(ctx) {
  const args = argsWithoutMentions(ctx)
  if (!args.length) throw new Error(`Uso: ${prefixOf(ctx)}use <objeto> o ${prefixOf(ctx)}use buy <objeto>`)
  const buy = lower(args[0]) === 'buy'
  const itemName = lower(buy ? args[1] : args[0])
  if (!SHOP[itemName] || itemName === 'ticket') throw new Error(`Objeto válido: ${Object.keys(SHOP).filter(x => x !== 'ticket').join(', ')}`)
  const result = withGachaState(state => {
    const user = userOf(state, ctx.sender)
    if (buy) {
      spendCoins(user, SHOP[itemName].price, `Compra ${itemName}`)
      user.items[itemName] = (user.items[itemName] || 0) + 1
      return `Compraste ${SHOP[itemName].label}.`
    }
    if ((user.items[itemName] || 0) < 1) throw new Error('No tienes ese objeto.')
    user.items[itemName] -= 1
    if (itemName === 'luck_potion') user.boosters.luck_potion = now() + 60 * 60 * 1000
    else if (itemName === 'wishlist_booster') user.boosters.wishlist_booster = now() + 2 * 60 * 60 * 1000
    else if (itemName === 'double_coins') user.boosters.double_coins = now() + 60 * 60 * 1000
    else if (['xp_card', 'snack', 'character_gift', 'reroll_token'].includes(itemName)) {
      user.items[itemName] += 1
      throw new Error(`Ese objeto se usa con su comando correspondiente, no con .use.`)
    }
    return `Activaste ${SHOP[itemName].label}.`
  })
  await reply(ctx, `✅ ${result}`)
}

async function itemsHandler(ctx) {
  const state = getGachaState()
  const user = userOf(state, ctx.sender)
  const entries = Object.entries(user.items).filter(([, n]) => n > 0)
  await reply(ctx, ['🎒 *Objetos*', `🎟️ Tickets: ${user.tickets}`, '', ...(entries.length ? entries.map(([id, n]) => `• ${SHOP[id]?.label || id}: ${n}`) : ['Sin objetos.'])].join('\n'))
}

async function boostersHandler(ctx) {
  const state = getGachaState()
  const user = userOf(state, ctx.sender)
  cleanBoosters(user)
  const entries = Object.entries(user.boosters).filter(([, until]) => until > now())
  await reply(ctx, ['⚡ *Boosters*', '', ...(entries.length ? entries.map(([id, until]) => `• ${id}: ${Math.ceil((until-now())/60000)} min`) : ['Ninguno activo.'])].join('\n'))
}

async function luckHandler(ctx) {
  const state = getGachaState()
  const user = userOf(state, ctx.sender)
  await reply(ctx, `🍀 Suerte: ${activeBoost(user, 'luck_potion') ? 'BOOST ACTIVO (+1 rareza en nuevos personajes)' : 'normal'}\nPity ★★★★★: ${user.pity.five}/70\nPity ★★★★★★: ${user.pity.six}/150`)
}

async function pityHandler(ctx, info = false) {
  if (info) {
    await reply(ctx, '🛡️ *Sistema Pity*\nCada tirada aumenta tus contadores. Un ★★★★★ reinicia el pity de 5★ y un ★★★★★★ reinicia ambos. Objetivo: 5★ a 70 y 6★ a 150.')
    return
  }
  const state = getGachaState()
  const user = userOf(state, ctx.sender)
  await reply(ctx, `🌟 *Pity*\n★★★★★: ${user.pity.five}/70\n★★★★★★: ${user.pity.six}/150\nGarantizado 5★ en: ${Math.max(0,70-user.pity.five)}\nGarantizado 6★ en: ${Math.max(0,150-user.pity.six)}`)
}

async function tradeStartHandler(ctx) {
  const target = targetJid(ctx)
  if (!target) throw new Error(`Uso: ${prefixOf(ctx)}trade @usuario`)
  if (jidKey(target) === jidKey(ctx.sender)) throw new Error('No puedes comerciar contigo mismo.')
  const trade = withGachaState(state => {
    const a = userOf(state, ctx.sender)
    const b = userOf(state, target)
    const existing = Object.values(state.trades).find(t => t.status === 'open' && [t.a, t.b].includes(jidKey(ctx.sender)))
    if (existing) throw new Error(`Ya tienes un trade abierto: ${existing.id}`)
    const id = txId('trade')
    state.trades[id] = {
      id, a: jidKey(ctx.sender), b: jidKey(target), status: 'open',
      offers: { [jidKey(ctx.sender)]: { items: [], coins: 0 }, [jidKey(target)]: { items: [], coins: 0 } },
      accepted: {}, createdAt: now()
    }
    a.activeTradeId = id
    b.activeTradeId = id
    return state.trades[id]
  })
  await reply(ctx, `🤝 Trade *${trade.id}* iniciado entre ${mention(ctx.sender)} y ${mention(target)}.`, { mentions: [ctx.sender, target] })
}

function activeTrade(state, sender) {
  const user = userOf(state, sender)
  const trade = state.trades[user.activeTradeId]
  if (!trade || trade.status !== 'open') throw new Error('No tienes un intercambio abierto.')
  return trade
}

async function tradeModifyHandler(ctx, action) {
  const arg = argsWithoutMentions(ctx).join(' ')
  const result = withGachaState(state => {
    const trade = activeTrade(state, ctx.sender)
    const user = userOf(state, ctx.sender)
    const key = jidKey(ctx.sender)
    const offer = trade.offers[key]
    trade.accepted = {}
    if (action === 'add') {
      const item = itemByArg(user, state, arg)
      if (!item) throw new Error('No encontré ese personaje.')
      if (item.locked || item.lockedByMarket || item.lockedByAuction) throw new Error('Ese personaje está protegido o publicado.')
      if (!offer.items.includes(item.uid)) offer.items.push(item.uid)
    } else if (action === 'remove') offer.items = offer.items.filter(x => x !== arg)
    else if (action === 'coins') {
      const n = Math.max(0, Number(arg) || 0)
      if (n > user.coins) throw new Error('No tienes suficientes monedas.')
      offer.coins = Math.floor(n)
    }
    return trade
  })
  await reply(ctx, `✅ Oferta actualizada en ${result.id}.`)
}

function tradeText(state, trade) {
  const side = jid => {
    const offer = trade.offers[jid]
    const user = userOf(state, jid)
    const names = offer.items.map(uid => {
      const item = user.collection.find(x => x.uid === uid)
      return `${charForItem(state, item)?.name || uid} (${uid})`
    })
    return `${mention(jid)}\n  Monedas: ${money(offer.coins)}\n  Personajes: ${names.join(', ') || 'ninguno'}\n  Aceptado: ${trade.accepted[jid] ? '✅' : '❌'}`
  }
  return `🤝 *${trade.id}*\n\n${side(trade.a)}\n\n${side(trade.b)}`
}

async function tradeViewHandler(ctx) {
  const state = getGachaState()
  const trade = activeTrade(state, ctx.sender)
  await reply(ctx, tradeText(state, trade), { mentions: [trade.a, trade.b] })
}

async function tradeAcceptHandler(ctx) {
  const result = withGachaState(state => {
    const trade = activeTrade(state, ctx.sender)
    const key = jidKey(ctx.sender)
    trade.accepted[key] = true
    if (!trade.accepted[trade.a] || !trade.accepted[trade.b]) return { done: false, trade }
    const ua = userOf(state, trade.a)
    const ub = userOf(state, trade.b)
    const oa = trade.offers[trade.a]
    const ob = trade.offers[trade.b]
    if (ua.coins < oa.coins || ub.coins < ob.coins) throw new Error('Una parte ya no tiene las monedas ofrecidas.')
    const ia = oa.items.map(uid => ua.collection.find(x => x.uid === uid)).filter(Boolean)
    const ib = ob.items.map(uid => ub.collection.find(x => x.uid === uid)).filter(Boolean)
    if (ia.length !== oa.items.length || ib.length !== ob.items.length) throw new Error('Una copia ofrecida ya no está disponible.')
    if ([...ia, ...ib].some(x => x.locked || x.lockedByMarket || x.lockedByAuction)) throw new Error('Hay un personaje bloqueado en la oferta.')
    ua.coins = ua.coins - oa.coins + ob.coins
    ub.coins = ub.coins - ob.coins + oa.coins
    ua.collection = ua.collection.filter(x => !oa.items.includes(x.uid))
    ub.collection = ub.collection.filter(x => !ob.items.includes(x.uid))
    ua.collection.push(...ib)
    ub.collection.push(...ia)
    ua.stats.trades += 1
    ub.stats.trades += 1
    trade.status = 'completed'
    trade.completedAt = now()
    ua.activeTradeId = null
    ub.activeTradeId = null
    state.tradeHistory.unshift({ id: trade.id, a: trade.a, b: trade.b, at: now() })
    state.tradeHistory = state.tradeHistory.slice(0, 100)
    return { done: true, trade }
  })
  await reply(ctx, result.done ? `✅ Trade ${result.trade.id} completado.` : '✅ Aceptaste. Falta la confirmación de la otra persona.')
}

async function tradeEndHandler(ctx, decline = false) {
  const result = withGachaState(state => {
    const trade = activeTrade(state, ctx.sender)
    trade.status = decline ? 'declined' : 'cancelled'
    userOf(state, trade.a).activeTradeId = null
    userOf(state, trade.b).activeTradeId = null
    return trade
  })
  await reply(ctx, `${decline ? '❌ Rechazado' : '🚫 Cancelado'}: ${result.id}`)
}

async function tradesHandler(ctx, history = false) {
  const state = getGachaState()
  if (history) {
    const rows = state.tradeHistory.filter(t => [t.a,t.b].includes(jidKey(ctx.sender))).slice(0, 20)
    await reply(ctx, ['📜 *Historial de trades*', '', ...(rows.length ? rows.map(t => `${t.id} • ${mention(t.a)} ↔ ${mention(t.b)}`) : ['Vacío.'])].join('\n'))
    return
  }
  const rows = Object.values(state.trades).filter(t => t.status === 'open' && [t.a,t.b].includes(jidKey(ctx.sender)))
  await reply(ctx, ['🤝 *Trades pendientes*', '', ...(rows.length ? rows.map(t => t.id) : ['Ninguno.'])].join('\n'))
}

async function giveHandler(ctx) {
  const target = targetJid(ctx)
  const arg = argsWithoutMentions(ctx).join(' ')
  if (!target || !arg) throw new Error(`Uso: ${prefixOf(ctx)}give <id> @usuario`)
  const result = withGachaState(state => {
    const from = userOf(state, ctx.sender)
    const to = userOf(state, target)
    const item = itemByArg(from, state, arg)
    if (!item) throw new Error('No encontré ese personaje.')
    if (item.locked || item.lockedByMarket || item.lockedByAuction) throw new Error('Ese personaje está protegido o publicado.')
    from.collection = from.collection.filter(x => x.uid !== item.uid)
    to.collection.push(item)
    from.stats.gifts += 1
    return { item, char: charForItem(state, item) }
  })
  await reply(ctx, `🎁 ${mention(ctx.sender)} regaló *${result.char?.name}* a ${mention(target)}.`, { mentions: [ctx.sender, target] })
}

async function giveCoinsHandler(ctx) {
  const target = targetJid(ctx)
  const amount = Number(argsWithoutMentions(ctx)[0])
  if (!target || amount <= 0) throw new Error(`Uso: ${prefixOf(ctx)}givecoins @usuario <cantidad>`)
  const sent = withGachaState(state => {
    const from = userOf(state, ctx.sender)
    const to = userOf(state, target)
    spendCoins(from, amount, 'Regalo de monedas')
    addCoins(to, amount, 'Regalo recibido')
    from.stats.gifts += 1
    return Math.floor(amount)
  })
  await reply(ctx, `🎁 ${money(sent)} monedas enviadas a ${mention(target)}.`, { mentions: [target] })
}

async function giftBoxHandler(ctx) {
  const target = targetJid(ctx)
  if (!target) throw new Error(`Uso: ${prefixOf(ctx)}gift @usuario`)
  const gift = withGachaState(state => {
    const from = userOf(state, ctx.sender)
    spendCoins(from, 200, 'Caja regalo')
    const id = txId('gift')
    state.gifts[id] = { id, from: jidKey(ctx.sender), to: jidKey(target), reward: { coins: random(100, 500), tickets: Math.random() < .2 ? 1 : 0 }, claimed: false, at: now() }
    return state.gifts[id]
  })
  await reply(ctx, `🎁 Caja ${gift.id} enviada a ${mention(target)}.`, { mentions: [target] })
}

async function giftsHandler(ctx, accept = false) {
  const result = withGachaState(state => {
    const rows = Object.values(state.gifts).filter(g => g.to === jidKey(ctx.sender) && !g.claimed)
    if (!accept) return { rows }
    const requested = argsWithoutMentions(ctx)[0]
    const gift = requested ? rows.find(g => g.id === requested) : rows[0]
    if (!gift) throw new Error('No tienes regalos pendientes.')
    const user = userOf(state, ctx.sender)
    addCoins(user, gift.reward.coins, 'Caja regalo')
    user.tickets += gift.reward.tickets || 0
    gift.claimed = true
    return { gift }
  })
  if (accept) await reply(ctx, `🎁 Abriste ${result.gift.id}: +${money(result.gift.reward.coins)} monedas${result.gift.reward.tickets ? ` +${result.gift.reward.tickets} ticket` : ''}.`)
  else await reply(ctx, ['🎁 *Regalos pendientes*', '', ...(result.rows.length ? result.rows.map(g => `${g.id} • de ${mention(g.from)}`) : ['Ninguno.'])].join('\n'))
}

async function sellPrepareHandler(ctx, previewOnly = false) {
  const arg = argsWithoutMentions(ctx).join(' ')
  const result = withGachaState(state => {
    const user = userOf(state, ctx.sender)
    const item = itemByArg(user, state, arg)
    if (!item) throw new Error('Personaje no encontrado.')
    if (item.locked || item.lockedByMarket || item.lockedByAuction) throw new Error('Ese personaje está protegido o publicado.')
    const char = charForItem(state, item)
    const price = Math.floor((char?.value || 0) * 0.6)
    if (!previewOnly) user.pendingSell = { uid: item.uid, price, at: now() }
    return { item, char, price }
  })
  await reply(ctx, `💵 ${result.char?.name}: recibirías *${money(result.price)}* monedas.${previewOnly ? '' : `\nConfirma con ${prefixOf(ctx)}sellconfirm`}`)
}

async function sellConfirmHandler(ctx) {
  const result = withGachaState(state => {
    const user = userOf(state, ctx.sender)
    const pending = user.pendingSell
    if (!pending || now() - pending.at > 120000) throw new Error('No hay venta pendiente o expiró.')
    const item = user.collection.find(x => x.uid === pending.uid)
    if (!item || item.locked || item.lockedByMarket || item.lockedByAuction) throw new Error('La copia ya no está disponible.')
    const char = charForItem(state, item)
    user.collection = user.collection.filter(x => x.uid !== item.uid)
    addCoins(user, pending.price, `Venta ${char?.name || item.charId}`)
    user.pendingSell = null
    return { char, price: pending.price }
  })
  await reply(ctx, `✅ Vendiste *${result.char?.name}* por ${money(result.price)} monedas.`)
}

async function sellCancelHandler(ctx) {
  withGachaState(state => { userOf(state, ctx.sender).pendingSell = null })
  await reply(ctx, '🚫 Venta cancelada.')
}

async function sellBulkHandler(ctx, duplicatesOnly = false) {
  const rarity = duplicatesOnly ? null : clamp(Number(ctx.args?.[0]) || 0, 1, 6)
  const result = withGachaState(state => {
    const user = userOf(state, ctx.sender)
    const seen = new Set()
    const sell = []
    for (const item of user.collection) {
      const char = charForItem(state, item)
      const can = !item.locked && !item.lockedByMarket && !item.lockedByAuction
      if (!can) continue
      if (duplicatesOnly) {
        if (seen.has(item.charId)) sell.push(item)
        else seen.add(item.charId)
      } else if ((item.rarity || char?.rarity) === rarity) sell.push(item)
    }
    if (!sell.length) throw new Error('No hay copias vendibles que coincidan.')
    const ids = new Set(sell.map(x => x.uid))
    let total = 0
    for (const item of sell) total += Math.floor((charForItem(state, item)?.value || 0) * 0.6)
    user.collection = user.collection.filter(x => !ids.has(x.uid))
    addCoins(user, total, duplicatesOnly ? 'Venta duplicados' : `Venta rareza ${rarity}`)
    return { count: sell.length, total }
  })
  await reply(ctx, `💵 Vendiste ${result.count} personaje(s) por ${money(result.total)} monedas.`)
}

async function marketListHandler(ctx) {
  const [arg, priceRaw] = argsWithoutMentions(ctx)
  const price = Math.floor(Number(priceRaw) || 0)
  if (!arg || price <= 0) throw new Error(`Uso: ${prefixOf(ctx)}marketlist <id-copia> <precio>`)
  const listing = withGachaState(state => {
    const user = userOf(state, ctx.sender)
    const item = itemByArg(user, state, arg)
    if (!item) throw new Error('Copia no encontrada.')
    if (item.locked || item.lockedByMarket || item.lockedByAuction) throw new Error('No se puede publicar esa copia.')
    const id = txId('mkt')
    item.lockedByMarket = id
    state.market[id] = { id, seller: jidKey(ctx.sender), itemUid: item.uid, charId: item.charId, price, status: 'active', at: now() }
    return state.market[id]
  })
  await reply(ctx, `🏪 Publicación ${listing.id} creada por ${money(listing.price)} monedas.`)
}

async function marketHandler(ctx, mode = 'list') {
  const state = getGachaState()
  let rows = Object.values(state.market).filter(x => x.status === 'active')
  if (mode === 'search') {
    const q = lower(argsWithoutMentions(ctx).join(' '))
    rows = rows.filter(x => lower(state.catalog[x.charId]?.name).includes(q))
  } else if (mode === 'mine') rows = rows.filter(x => x.seller === jidKey(ctx.sender))
  await reply(ctx, [`🏪 *Mercado*`, '', ...(rows.slice(0, 30).map(x => `${x.id} • ${state.catalog[x.charId]?.name || x.charId} • ${money(x.price)} • ${mention(x.seller)}`) || ['Sin publicaciones.'])].join('\n'))
}

async function marketRemoveHandler(ctx) {
  const id = argsWithoutMentions(ctx)[0]
  const result = withGachaState(state => {
    const listing = state.market[id]
    if (!listing || listing.status !== 'active') throw new Error('Publicación no encontrada.')
    if (listing.seller !== jidKey(ctx.sender) && !ctx.isOwner) throw new Error('No es tu publicación.')
    const seller = userOf(state, listing.seller)
    const item = seller.collection.find(x => x.uid === listing.itemUid)
    if (item) item.lockedByMarket = null
    listing.status = 'removed'
    return listing
  })
  await reply(ctx, `🗑️ Retirada ${result.id}.`)
}

async function marketBuyHandler(ctx) {
  const id = argsWithoutMentions(ctx)[0]
  const result = withGachaState(state => {
    const listing = state.market[id]
    if (!listing || listing.status !== 'active') throw new Error('Publicación no disponible.')
    if (listing.seller === jidKey(ctx.sender)) throw new Error('No puedes comprar tu propia publicación.')
    const seller = userOf(state, listing.seller)
    const buyer = userOf(state, ctx.sender)
    const item = seller.collection.find(x => x.uid === listing.itemUid)
    if (!item) throw new Error('La copia ya no existe.')
    spendCoins(buyer, listing.price, `Compra mercado ${id}`)
    addCoins(seller, listing.price, `Venta mercado ${id}`)
    seller.collection = seller.collection.filter(x => x.uid !== item.uid)
    item.lockedByMarket = null
    buyer.collection.push(item)
    listing.status = 'sold'
    listing.buyer = jidKey(ctx.sender)
    listing.soldAt = now()
    state.recentMarket.unshift({ type: 'market', charId: item.charId, price: listing.price, at: now() })
    state.recentMarket = state.recentMarket.slice(0, 100)
    return { listing, char: charForItem(state, item) }
  })
  await reply(ctx, `✅ Compraste *${result.char?.name}* por ${money(result.listing.price)} monedas.`)
}

async function marketRecentHandler(ctx) {
  const state = getGachaState()
  await reply(ctx, ['🧾 *Ventas recientes*', '', ...(state.recentMarket.slice(0,20).map(x => `${state.catalog[x.charId]?.name || x.charId} • ${money(x.price)} • ${x.type}`) || ['Sin ventas.'])].join('\n'))
}

async function marketValueHandler(ctx) {
  const q = argsWithoutMentions(ctx).join(' ')
  const state = getGachaState()
  const char = catalogMatch(state, q)
  if (!char) throw new Error('Personaje no encontrado.')
  const sales = state.recentMarket.filter(x => x.charId === char.id)
  const avg = sales.length ? Math.round(sales.reduce((s,x)=>s+x.price,0)/sales.length) : char.value
  await reply(ctx, `📈 *${char.name}*\nValor base: ${money(char.value)}\nPromedio mercado: ${money(avg)}\nVentas registradas: ${sales.length}`)
}

async function auctionCreateHandler(ctx) {
  const [arg, priceRaw] = argsWithoutMentions(ctx)
  const startPrice = Math.floor(Number(priceRaw) || 0)
  if (!arg || startPrice <= 0) throw new Error(`Uso: ${prefixOf(ctx)}auction <id-copia> <precio>`)
  const auction = withGachaState(state => {
    const user = userOf(state, ctx.sender)
    const item = itemByArg(user, state, arg)
    if (!item) throw new Error('Copia no encontrada.')
    if (item.locked || item.lockedByMarket || item.lockedByAuction) throw new Error('La copia está bloqueada.')
    const id = txId('auc')
    item.lockedByAuction = id
    state.auctions[id] = { id, seller: jidKey(ctx.sender), itemUid: item.uid, charId: item.charId, startPrice, bids: [], status: 'active', createdAt: now(), endsAt: now() + 60*60*1000 }
    return state.auctions[id]
  })
  await reply(ctx, `🔨 Subasta ${auction.id} creada. Precio inicial: ${money(startPrice)}. Duración: 60 min.`)
}

async function bidHandler(ctx) {
  const [id, amountRaw] = argsWithoutMentions(ctx)
  const amount = Math.floor(Number(amountRaw) || 0)
  const result = withGachaState(state => {
    cleanupExpired(state)
    const auction = state.auctions[id]
    if (!auction || auction.status !== 'active') throw new Error('Subasta no disponible.')
    if (auction.seller === jidKey(ctx.sender)) throw new Error('No puedes pujar en tu propia subasta.')
    const user = userOf(state, ctx.sender)
    const highest = Math.max(auction.startPrice - 1, ...auction.bids.map(b => b.amount))
    if (amount <= highest) throw new Error(`Debes superar ${money(highest)}.`)
    if (user.coins < amount) throw new Error('No tienes suficientes monedas para respaldar esa puja.')
    auction.bids.push({ jid: jidKey(ctx.sender), amount, at: now() })
    return auction
  })
  await reply(ctx, `🔨 Puja registrada: ${money(amount)} en ${result.id}.`)
}

async function auctionsHandler(ctx, mine = false) {
  const state = getGachaState()
  cleanupExpired(state)
  const rows = Object.values(state.auctions).filter(a => a.status === 'active' && (!mine || a.seller === jidKey(ctx.sender)))
  await reply(ctx, ['🔨 *Subastas*', '', ...(rows.slice(0,30).map(a => `${a.id} • ${state.catalog[a.charId]?.name || a.charId} • inicio ${money(a.startPrice)} • pujas ${a.bids.length}`) || ['Ninguna.'])].join('\n'))
}

async function auctionInfoHandler(ctx) {
  const id = argsWithoutMentions(ctx)[0]
  const state = getGachaState()
  const a = state.auctions[id]
  if (!a) throw new Error('Subasta no encontrada.')
  const high = [...a.bids].sort((x,y)=>y.amount-x.amount)[0]
  await reply(ctx, `🔨 *${a.id}*\nPersonaje: ${state.catalog[a.charId]?.name || a.charId}\nEstado: ${a.status}\nInicial: ${money(a.startPrice)}\nMayor puja: ${high ? `${money(high.amount)} por ${mention(high.jid)}` : 'ninguna'}\nFinaliza: ${new Date(a.endsAt).toLocaleString('es-PE')}`, { mentions: high ? [high.jid] : [] })
}

async function auctionCancelHandler(ctx) {
  const id = argsWithoutMentions(ctx)[0]
  const result = withGachaState(state => {
    const a = state.auctions[id]
    if (!a || a.status !== 'active') throw new Error('Subasta no disponible.')
    if (a.seller !== jidKey(ctx.sender) && !ctx.isOwner) throw new Error('No es tu subasta.')
    if (a.bids.length) throw new Error('No se puede cancelar una subasta que ya tiene pujas.')
    const seller = userOf(state, a.seller)
    const item = seller.collection.find(x => x.uid === a.itemUid)
    if (item) item.lockedByAuction = null
    a.status = 'cancelled'
    return a
  })
  await reply(ctx, `🚫 Subasta ${result.id} cancelada.`)
}

async function affinityHandler(ctx) {
  const arg = argsWithoutMentions(ctx).join(' ')
  const state = getGachaState()
  const user = userOf(state, ctx.sender)
  const item = itemByArg(user, state, arg)
  if (!item) throw new Error('Personaje no encontrado.')
  const char = charForItem(state, item)
  await reply(ctx, `💞 *${char?.name}*\nAfinidad: ${item.affinity || 0}/100\nNivel: ${item.level || 1}\nApodo: ${item.nickname || 'ninguno'}`)
}

async function affinityActionHandler(ctx, action) {
  const arg = argsWithoutMentions(ctx)[0]
  const result = withGachaState(state => {
    const user = userOf(state, ctx.sender)
    const item = itemByArg(user, state, arg)
    if (!item) throw new Error('Personaje no encontrado.')
    const char = charForItem(state, item)
    if (action === 'interact') {
      const key = `interact:${item.uid}`
      if (cooldownLeft(user, key, 86400) > 0) throw new Error('Ya interactuaste hoy con este personaje.')
      item.affinity = clamp((item.affinity || 0) + 5, 0, 100)
      useCooldown(user, key)
    } else if (action === 'feed') {
      if ((user.items.snack || 0) < 1) throw new Error('Necesitas un snack. Cómpralo con .use buy snack')
      user.items.snack -= 1
      item.affinity = clamp((item.affinity || 0) + 3, 0, 100)
    } else if (action === 'giftchar') {
      if ((user.items.character_gift || 0) < 1) throw new Error('Necesitas character_gift.')
      user.items.character_gift -= 1
      item.affinity = clamp((item.affinity || 0) + 10, 0, 100)
    } else if (action === 'date') {
      const key = `date:${item.uid}`
      if (cooldownLeft(user, key, 604800) > 0) throw new Error('La cita semanal aún está en cooldown.')
      spendCoins(user, 100, 'Cita')
      item.affinity = clamp((item.affinity || 0) + 15, 0, 100)
      useCooldown(user, key)
    }
    return { item, char }
  })
  await reply(ctx, `💞 ${result.char?.name}: afinidad ${result.item.affinity}/100.`)
}

async function profileCharHandler(ctx) {
  const arg = argsWithoutMentions(ctx).join(' ')
  const state = getGachaState()
  const user = userOf(state, ctx.sender)
  const item = itemByArg(user, state, arg)
  if (!item) throw new Error('Personaje no encontrado.')
  const char = charForItem(state, item)
  await sendCharacter(ctx, char, formatCharacter(char, item))
}

async function nicknameCharHandler(ctx) {
  const [arg, ...nameParts] = argsWithoutMentions(ctx)
  const nickname = nameParts.join(' ').slice(0,30)
  if (!arg || !nickname) throw new Error(`Uso: ${prefixOf(ctx)}nicknamechar <id> <apodo>`)
  const result = withGachaState(state => {
    const user = userOf(state, ctx.sender)
    const item = itemByArg(user, state, arg)
    if (!item) throw new Error('Personaje no encontrado.')
    item.nickname = nickname
    return charForItem(state, item)
  })
  await reply(ctx, `🏷️ ${result?.name} ahora se llama *${nickname}* en tu colección.`)
}

async function maxAffinityHandler(ctx) {
  const state = getGachaState()
  const user = userOf(state, ctx.sender)
  const rows = user.collection.filter(x => (x.affinity || 0) >= 100)
  await reply(ctx, ['💞 *Afinidad máxima*', '', ...(rows.length ? rows.map(x => `${charForItem(state,x)?.name} • ${x.uid}`) : ['Ninguno.'])].join('\n'))
}

async function marryHandler(ctx) {
  const arg = argsWithoutMentions(ctx).join(' ')
  const result = withGachaState(state => {
    const user = userOf(state, ctx.sender)
    const item = itemByArg(user, state, arg)
    if (!item) throw new Error('Personaje no encontrado.')
    if ((item.affinity || 0) < 100) throw new Error('Necesitas 100 de afinidad para establecerlo como pareja.')
    user.partnerUid = item.uid
    return { item, char: charForItem(state,item) }
  })
  await reply(ctx, `💍 ${mention(ctx.sender)} eligió a *${result.char?.name}* como pareja.`)
}

async function divorceHandler(ctx) {
  withGachaState(state => { userOf(state, ctx.sender).partnerUid = null })
  await reply(ctx, '💔 Tu pareja Gacha fue retirada del perfil. El personaje sigue en tu colección.')
}

async function partnerHandler(ctx) {
  const target = collectionTarget(ctx)
  const state = getGachaState()
  const user = userOf(state, target)
  const item = user.collection.find(x => x.uid === user.partnerUid)
  if (!item) throw new Error('Ese usuario no tiene pareja Gacha.')
  const char = charForItem(state,item)
  await sendCharacter(ctx, char, `💍 *Pareja de ${mention(target)}*\n\n${formatCharacter(char,item)}`)
}

async function levelHandler(ctx) {
  const arg = argsWithoutMentions(ctx).join(' ')
  const state = getGachaState()
  const user = userOf(state, ctx.sender)
  const item = itemByArg(user,state,arg)
  if (!item) throw new Error('Personaje no encontrado.')
  await reply(ctx, `📈 ${charForItem(state,item)?.name}\nNivel: ${item.level || 1}/100\nXP: ${item.xp || 0}/${(item.level || 1)*100}\nEvolución: ${item.evolution || 0}\nAscensión: ${item.ascension || 0}\nPoder: ${powerOf(state,item)}`)
}

async function feedXpHandler(ctx) {
  const arg = argsWithoutMentions(ctx)[0]
  const result = withGachaState(state => {
    const user = userOf(state, ctx.sender)
    if ((user.items.xp_card || 0) < 1) throw new Error('Necesitas una XP Card. Compra con .use buy xp_card')
    const item = itemByArg(user,state,arg)
    if (!item) throw new Error('Personaje no encontrado.')
    user.items.xp_card -= 1
    item.xp = (item.xp || 0) + 250
    while (item.level < 100 && item.xp >= item.level * 100) {
      item.xp -= item.level * 100
      item.level += 1
    }
    return { item, char: charForItem(state,item) }
  })
  await reply(ctx, `📘 ${result.char?.name}: nivel ${result.item.level}, XP ${result.item.xp}.`)
}

async function upgradeHandler(ctx, action) {
  const arg = argsWithoutMentions(ctx)[0]
  const result = withGachaState(state => {
    const user = userOf(state, ctx.sender)
    const item = itemByArg(user,state,arg)
    if (!item) throw new Error('Personaje no encontrado.')
    if (action === 'upgrade') {
      if (item.level >= 100) throw new Error('Ya está al máximo nivel.')
      const cost = item.level * 40
      spendCoins(user,cost,'Upgrade')
      item.level += 1
    } else if (action === 'evolve') {
      if (item.level < 20) throw new Error('Necesitas nivel 20.')
      if ((item.evolution || 0) >= 3) throw new Error('Evolución máxima.')
      spendCoins(user,1500*(item.evolution+1),'Evolve')
      item.evolution += 1
    } else if (action === 'ascend') {
      if (item.level < 50) throw new Error('Necesitas nivel 50.')
      if ((item.ascension || 0) >= 2) throw new Error('Ascensión máxima.')
      spendCoins(user,5000*(item.ascension+1),'Ascend')
      item.ascension += 1
    } else if (action === 'max') {
      while (item.level < 100) {
        const cost = item.level * 40
        if (user.coins < cost) break
        spendCoins(user,cost,'Max upgrade')
        item.level += 1
      }
    }
    return { item, char: charForItem(state,item) }
  })
  await reply(ctx, `⚙️ ${result.char?.name}: nivel ${result.item.level}, evolución ${result.item.evolution}, ascensión ${result.item.ascension}.`)
}

async function statsCharHandler(ctx) {
  const arg = argsWithoutMentions(ctx).join(' ')
  const state = getGachaState()
  const user = userOf(state,ctx.sender)
  const item = itemByArg(user,state,arg)
  if (!item) throw new Error('Personaje no encontrado.')
  const char = charForItem(state,item)
  await reply(ctx, `${formatCharacter(char,item)}\n⚔️ Poder: ${powerOf(state,item)}`)
}

async function materialsHandler(ctx) {
  const state = getGachaState()
  const user = userOf(state,ctx.sender)
  await reply(ctx, `🧬 *Materiales*\nXP Card: ${user.items.xp_card || 0}\nSnack: ${user.items.snack || 0}\nCharacter Gift: ${user.items.character_gift || 0}`)
}

async function teamHandler(ctx) {
  const state = getGachaState()
  const user = userOf(state,ctx.sender)
  const ids = userTeam(user)
  const rows = ids.map((uid,i)=>{
    const item=user.collection.find(x=>x.uid===uid)
    return `${i+1}. ${charForItem(state,item)?.name || uid} • ${powerOf(state,item)} poder`
  })
  await reply(ctx, [`⚔️ *Equipo ${user.activeTeam}*`, `Poder: ${teamPower(state,user)}`, '', ...(rows.length?rows:['Vacío.'])].join('\n'))
}

async function teamModifyHandler(ctx, action) {
  const args = argsWithoutMentions(ctx)
  const result = withGachaState(state => {
    const user = userOf(state,ctx.sender)
    const team = userTeam(user)
    if (action === 'add') {
      const item=itemByArg(user,state,args[0]); if(!item) throw new Error('Personaje no encontrado.')
      if(team.includes(item.uid)) throw new Error('Ya está en el equipo.')
      if(team.length>=5) throw new Error('El equipo admite máximo 5 personajes.')
      team.push(item.uid)
    } else if (action === 'remove') {
      const item=itemByArg(user,state,args[0]); if(!item) throw new Error('Personaje no encontrado.')
      user.teams[user.activeTeam]=team.filter(x=>x!==item.uid)
    } else if (action === 'set') {
      const pos=clamp(Number(args[0])||1,1,5)-1
      const item=itemByArg(user,state,args[1]); if(!item) throw new Error('Personaje no encontrado.')
      const filtered=team.filter(x=>x!==item.uid); filtered[pos]=item.uid; user.teams[user.activeTeam]=filtered.filter(Boolean).slice(0,5)
    } else if (action === 'clear') user.teams[user.activeTeam]=[]
    else if (action === 'save') {
      const name=clean(args.join(' ')).slice(0,20); if(!name) throw new Error('Indica un nombre.')
      user.teams[name]=[...team]
    } else if (action === 'load') {
      const name=clean(args.join(' ')); if(!user.teams[name]) throw new Error('Equipo guardado no encontrado.')
      user.activeTeam=name
    }
    return { name:user.activeTeam,power:teamPower(state,user) }
  })
  await reply(ctx, `✅ Equipo ${result.name} actualizado. Poder: ${result.power}.`)
}

async function teamsHandler(ctx) {
  const state=getGachaState(); const user=userOf(state,ctx.sender)
  await reply(ctx,['📂 *Equipos guardados*','',...Object.entries(user.teams).map(([n,ids])=>`${n===user.activeTeam?'✅':'•'} ${n} (${ids.length}/5)`) ].join('\n'))
}

async function pveHandler(ctx, mode) {
  const result=withGachaState(state=>{
    ensurePlayerAllowed(state,ctx)
    const user=userOf(state,ctx.sender)
    const power=teamPower(state,user)
    if(power<=0) throw new Error('Configura un equipo con .teamadd antes de combatir.')
    const key=`pve:${mode}`; const sec=mode==='battle'?120:mode==='dungeon'?900:1800
    const left=cooldownLeft(user,key,sec); if(left>0) throw new Error(`Cooldown: ${Math.ceil(left/1000)}s.`)
    const enemy=Math.max(100,Math.floor(power* (0.75+Math.random()*0.7)))
    const win=power>=enemy || Math.random()<0.2
    let reward=win?Math.max(50,Math.floor(enemy/15)):Math.max(10,Math.floor(enemy/50))
    if(activeBoost(user,'double_coins')) reward*=2
    addCoins(user,reward,`PvE ${mode}`); user.stats.battles+=1; if(win) user.stats.wins+=1; useCooldown(user,key)
    for(const uid of userTeam(user)){ const item=user.collection.find(x=>x.uid===uid); if(item) item.xp=(item.xp||0)+(win?80:25) }
    return {power,enemy,win,reward}
  })
  await reply(ctx,`⚔️ *${mode.toUpperCase()}*\nTu poder: ${result.power}\nEnemigo: ${result.enemy}\nResultado: ${result.win?'🏆 Victoria':'💥 Derrota'}\nRecompensa: ${money(result.reward)} monedas.`)
}

async function bossHandler(ctx, attack=false) {
  const result=withGachaState(state=>{
    if(!state.boss || state.boss.expiresAt<=now() || state.boss.hp<=0){
      state.boss={id:txId('boss'),name:'Astaroth Eclipse',maxHp:100000,hp:100000,expiresAt:now()+24*60*60*1000,rewards:{coins:2500}}
    }
    if(!attack) return {boss:state.boss}
    const user=userOf(state,ctx.sender); const left=cooldownLeft(user,'bossattack',300); if(left>0) throw new Error(`Puedes atacar otra vez en ${Math.ceil(left/1000)}s.`)
    const power=teamPower(state,user); if(power<=0) throw new Error('Necesitas un equipo.')
    const damage=Math.max(100,Math.floor(power*(0.5+Math.random())))
    state.boss.hp=Math.max(0,state.boss.hp-damage); useCooldown(user,'bossattack')
    const reward=Math.max(20,Math.floor(damage/50)); addCoins(user,reward,'Ataque boss')
    if(state.boss.hp===0) addCoins(user,state.boss.rewards.coins,'Boss derrotado')
    return {boss:state.boss,damage,reward}
  })
  if(attack) await reply(ctx,`👹 Atacaste a *${result.boss.name}* por ${money(result.damage)} daño.\nHP: ${money(result.boss.hp)}/${money(result.boss.maxHp)}\n+${money(result.reward)} monedas.`)
  else await reply(ctx,`👹 *${result.boss.name}*\nHP: ${money(result.boss.hp)}/${money(result.boss.maxHp)}\nUsa ${prefixOf(ctx)}attack cada 5 min.`)
}

async function expeditionHandler(ctx) {
  const arg=argsWithoutMentions(ctx)[0]
  const exp=withGachaState(state=>{
    const user=userOf(state,ctx.sender); const item=itemByArg(user,state,arg); if(!item) throw new Error('Personaje no encontrado.')
    if(user.expeditions.some(e=>e.uid===item.uid && !e.claimed)) throw new Error('Ese personaje ya está en expedición.')
    const id=txId('exp'); const duration=60*60*1000
    const e={id,uid:item.uid,charId:item.charId,startedAt:now(),endsAt:now()+duration,claimed:false,reward:{coins:random(250,700),xp:300}}
    user.expeditions.push(e); return e
  })
  await reply(ctx,`🧭 Expedición ${exp.id} iniciada. Regresa en 60 min.`)
}

async function expeditionsHandler(ctx) {
  const state=getGachaState(); const user=userOf(state,ctx.sender)
  await reply(ctx,['🧭 *Expediciones*','',...(user.expeditions.filter(e=>!e.claimed).map(e=>`${e.id} • ${state.catalog[e.charId]?.name||e.charId} • ${e.endsAt<=now()?'✅ lista':`${Math.ceil((e.endsAt-now())/60000)} min`}`) || ['Ninguna.'])].join('\n'))
}

async function claimExpeditionHandler(ctx) {
  const requested=argsWithoutMentions(ctx)[0]
  const result=withGachaState(state=>{
    const user=userOf(state,ctx.sender); const rows=user.expeditions.filter(e=>!e.claimed && e.endsAt<=now()); const e=requested?rows.find(x=>x.id===requested):rows[0]
    if(!e) throw new Error('No hay expediciones listas.')
    const item=user.collection.find(x=>x.uid===e.uid); addCoins(user,e.reward.coins,'Expedición'); if(item) item.xp=(item.xp||0)+e.reward.xp; e.claimed=true
    return e
  })
  await reply(ctx,`🧭 Expedición completada: +${money(result.reward.coins)} monedas y +${result.reward.xp} XP.`)
}

async function topHandler(ctx, type) {
  const state=getGachaState()
  const metric={
    topgacha:u=>collectionValue(state,u)+u.coins,
    topvalue:u=>collectionValue(state,u),
    toprarity:u=>u.collection.reduce((s,x)=>s+(x.rarity||state.catalog[x.charId]?.rarity||1),0),
    topclaims:u=>u.stats.claims,
    topcoins:u=>u.coins,
    topcompletion:u=>new Set(u.collection.map(x=>x.charId)).size,
    topwishlist:u=>u.wishlist.length
  }[type] || (u=>0)
  const rows=topUsers(state,metric)
  await reply(ctx,[`🏆 *${type}*`,'',...rows.map((r,i)=>`${i+1}. ${mention(r.jid)} — ${money(r.value)}`)].join('\n'),{mentions:rows.map(r=>r.jid)})
}

async function topCharacterHandler(ctx) {
  const state=getGachaState(); const counts={}
  for(const u of Object.values(state.users)) for(const item of u.collection) counts[item.charId]=(counts[item.charId]||0)+1
  const rows=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,15)
  await reply(ctx,['🏆 *Personajes más poseídos*','',...rows.map(([id,n],i)=>`${i+1}. ${state.catalog[id]?.name||id} — ${n} copias`)].join('\n'))
}

async function topSeriesHandler(ctx) {
  const q=lower(argsWithoutMentions(ctx).join(' ')); if(!q) throw new Error(`Uso: ${prefixOf(ctx)}topseries <anime>`)
  const state=getGachaState(); const ids=new Set(Object.values(state.catalog).filter(c=>lower(c.series).includes(q)).map(c=>c.id)); if(!ids.size) throw new Error('Serie no encontrada.')
  const rows=topUsers(state,u=>u.collection.filter(x=>ids.has(x.charId)).length)
  await reply(ctx,[`🏆 *Top ${q}*`,'',...rows.map((r,i)=>`${i+1}. ${mention(r.jid)} — ${r.value}`)].join('\n'),{mentions:rows.map(r=>r.jid)})
}

async function gachaStatsHandler(ctx) {
  const target=collectionTarget(ctx); const state=getGachaState(); const u=userOf(state,target)
  await reply(ctx,`📊 *Stats de ${mention(target)}*\nRolls: ${u.stats.rolls}\nClaims: ${u.stats.claims}\nMejor rareza: ${stars(Math.max(1,u.stats.bestRarity))}\nPeor racha: ${u.stats.worstLuck}\nMonedas ganadas: ${money(u.stats.coinsEarned)}\nGastadas: ${money(u.stats.coinsSpent)}\nTrades: ${u.stats.trades}\nBatallas: ${u.stats.battles}\nVictorias: ${u.stats.wins}`,{mentions:[target]})
}

async function simpleStatHandler(ctx, type) {
  const state=getGachaState(); const u=userOf(state,ctx.sender)
  const map={claims:u.stats.claims,rolls:u.stats.rolls,worstluck:u.stats.worstLuck,spent:u.stats.coinsSpent,earned:u.stats.coinsEarned,tradestats:u.stats.trades}
  if(type==='luckstats'){
    const counts=Array(7).fill(0); for(const x of u.collection) counts[x.rarity||state.catalog[x.charId]?.rarity||1]++
    await reply(ctx,['🍀 *Rarezas obtenidas*','',...[1,2,3,4,5,6].map(n=>`${stars(n)}: ${counts[n]}`)].join('\n')); return
  }
  if(type==='bestpull'){
    const best=[...u.collection].sort((a,b)=>(b.rarity||0)-(a.rarity||0))[0]; if(!best) throw new Error('No tienes personajes.')
    await sendCharacter(ctx,charForItem(state,best),`🌟 *Mejor pull*\n\n${formatCharacter(charForItem(state,best),best)}`); return
  }
  await reply(ctx,`📊 ${type}: *${money(map[type]||0)}*`)
}

async function achievementsHandler(ctx) {
  const state=getGachaState(); const u=userOf(state,ctx.sender); const status=achievementStatus(state,u)
  await reply(ctx,['🏅 *Logros*','',...Object.entries(ACHIEVEMENTS).map(([id,a])=>`${status[id]?'✅':'⬜'} ${id} — ${a.title}${u.claimedAchievements.includes(id)?' (reclamado)':''}`)].join('\n'))
}

async function achievementHandler(ctx) {
  const id=argsWithoutMentions(ctx)[0]; const a=ACHIEVEMENTS[id]; if(!a) throw new Error('Logro no encontrado.')
  const state=getGachaState(); const u=userOf(state,ctx.sender); const unlocked=achievementStatus(state,u)[id]
  await reply(ctx,`🏅 *${a.title}*\n${a.description}\nRecompensa: ${money(a.reward)} monedas\nEstado: ${u.claimedAchievements.includes(id)?'✅ reclamado':unlocked?'🎁 disponible':'⬜ bloqueado'}`)
}

async function claimAchievementHandler(ctx) {
  const id=argsWithoutMentions(ctx)[0]; const a=ACHIEVEMENTS[id]; if(!a) throw new Error('Logro no encontrado.')
  const result=withGachaState(state=>{
    const u=userOf(state,ctx.sender); if(!achievementStatus(state,u)[id]) throw new Error('Aún no desbloqueaste ese logro.'); if(u.claimedAchievements.includes(id)) throw new Error('Ya lo reclamaste.')
    u.claimedAchievements.push(id); addCoins(u,a.reward,`Logro ${id}`); return a
  })
  await reply(ctx,`🏅 Reclamaste *${result.title}*: +${money(result.reward)} monedas.`)
}

async function badgesHandler(ctx) {
  const state=getGachaState(); const u=userOf(state,ctx.sender)
  await reply(ctx,`🎖️ Badges: ${u.badges.join(' ')}\nActivo: ${u.profile.badge}`)
}

async function badgeHandler(ctx) {
  const value=argsWithoutMentions(ctx).join(' '); withGachaState(state=>{const u=userOf(state,ctx.sender); if(!u.badges.includes(value)) throw new Error('No tienes ese badge.'); u.profile.badge=value})
  await reply(ctx,`🎖️ Badge activo: ${value}`)
}

async function eventHandler(ctx, mode) {
  const state=getGachaState(); const active=Object.values(state.events).find(e=>e.active)
  if(mode==='event'){
    if(!active) throw new Error('No hay evento activo.')
    await reply(ctx,`🎊 *${active.name}*\nID: ${active.id}\nBanner: ${active.bannerId||'ninguno'}\nFinaliza: ${active.endsAt?new Date(active.endsAt).toLocaleString('es-PE'):'sin fecha'}`); return
  }
  if(mode==='points'){
    const u=userOf(state,ctx.sender); await reply(ctx,`🎊 Puntos de evento: ${u.eventPoints||0}`); return
  }
  if(mode==='ranking'){
    const rows=topUsers(state,u=>u.eventPoints||0); await reply(ctx,['🏆 *Ranking evento*','',...rows.map((r,i)=>`${i+1}. ${mention(r.jid)} — ${r.value}`)].join('\n'),{mentions:rows.map(r=>r.jid)}); return
  }
  if(mode==='missions'){
    await reply(ctx,'🎯 *Misiones de evento*\n• Haz 5 rolls: +100 puntos\n• Reclama un 4★+: +250 puntos\n• Gana una batalla: +150 puntos'); return
  }
  if(mode==='claim'){
    const result=withGachaState(s=>{const u=userOf(s,ctx.sender); const pts=u.eventPoints||0; const tier=Math.floor(pts/500); const claimed=u.eventClaimedTier||0; if(tier<=claimed) throw new Error('No tienes recompensas nuevas.'); const reward=(tier-claimed)*500; u.eventClaimedTier=tier; addCoins(u,reward,'Evento'); return reward}); await reply(ctx,`🎊 Recompensa de evento: +${money(result)} monedas.`); return
  }
  if(mode==='shop'){
    await reply(ctx,'🎊 *Event Shop*\n500 puntos → 1 ticket\n1000 puntos → Luck Potion\nLas compras especiales se habilitan mediante el evento activo.'); return
  }
}

async function eventRollHandler(ctx) {
  const state=getGachaState(); const active=Object.values(state.events).find(e=>e.active); if(!active) throw new Error('No hay evento activo.')
  const banner=state.banners[active.bannerId]; if(!banner) return rollHandler(ctx)
  const choices=(banner.characterIds||[]).map(id=>state.catalog[id]).filter(Boolean); if(!choices.length) return rollHandler(ctx)
  const char=choices[random(0,choices.length-1)]
  const result=withGachaState(s=>{const u=userOf(s,ctx.sender); if(u.tickets<1) throw new Error('Necesitas 1 ticket.'); u.tickets-=1; const item={uid:instanceId(),charId:char.id,rarity:char.rarity,obtainedAt:now(),source:`event:${active.id}`,level:1,xp:0,affinity:0,nickname:'',locked:false,evolution:0,ascension:0}; u.collection.push(item); u.eventPoints=(u.eventPoints||0)+100; u.stats.rolls+=1; return item})
  await sendCharacter(ctx,char,`🎊 *EVENT ROLL*\n\n${formatCharacter(char,result)}\n+100 puntos de evento.`)
}

async function bannersHandler(ctx, info=false) {
  const state=getGachaState(); if(info){const id=argsWithoutMentions(ctx)[0]; const b=state.banners[id]; if(!b) throw new Error('Banner no encontrado.'); await reply(ctx,`🎟️ *${b.name}*\nID: ${b.id}\nPersonajes: ${(b.characterIds||[]).map(x=>state.catalog[x]?.name||x).join(', ')||'ninguno'}\nActivo: ${b.active?'sí':'no'}`); return}
  const rows=Object.values(state.banners); await reply(ctx,['🎟️ *Banners*','',...(rows.length?rows.map(b=>`${b.active?'✅':'•'} ${b.id} — ${b.name}`):['Ninguno.'])].join('\n'))
}

async function redeemHandler(ctx) {
  const code=clean(argsWithoutMentions(ctx)[0]).toUpperCase(); if(!code) throw new Error(`Uso: ${prefixOf(ctx)}redeem <código>`)
  const result=withGachaState(state=>{const entry=state.codes[code]; if(!entry||entry.active===false) throw new Error('Código inválido.'); entry.usedBy ||= []; const key=jidKey(ctx.sender); if(entry.usedBy.includes(key)) throw new Error('Ya usaste este código.'); if(entry.maxUses && entry.usedBy.length>=entry.maxUses) throw new Error('Código agotado.'); const u=userOf(state,ctx.sender); if(entry.coins) addCoins(u,entry.coins,`Código ${code}`); if(entry.tickets) u.tickets+=entry.tickets; entry.usedBy.push(key); return entry})
  await reply(ctx,`🎟️ Código canjeado: +${money(result.coins||0)} monedas, +${result.tickets||0} tickets.`)
}

async function codesHandler(ctx) {
  const state=getGachaState(); const rows=Object.entries(state.codes).filter(([,c])=>c.active!==false && c.public!==false)
  await reply(ctx,['🎟️ *Códigos activos*','',...(rows.length?rows.map(([id,c])=>`${id} • ${c.coins||0} monedas • ${c.tickets||0} tickets`):['Ninguno.'])].join('\n'))
}

async function gachaProfileHandler(ctx) {
  const target=collectionTarget(ctx); const state=getGachaState(); const u=userOf(state,target); if(u.profile.privacy==='private' && jidKey(target)!==jidKey(ctx.sender) && !ctx.isOwner) throw new Error('Este perfil es privado.')
  const card=u.collection.find(x=>x.uid===u.profile.cardUid) || u.collection.find(x=>x.uid===u.favoriteUid); const char=charForItem(state,card)
  const text=`${u.profile.badge} *Perfil Gacha de ${mention(target)}*\nTítulo: ${u.profile.title}\nBio: ${u.profile.bio||'Sin bio'}\nClaims: ${u.stats.claims}\nColección: ${u.collection.length}\nValor: ${money(collectionValue(state,u))}\nPareja: ${charForItem(state,u.collection.find(x=>x.uid===u.partnerUid))?.name||'ninguna'}`
  if(char) await sendCharacter(ctx,char,`${text}\nCarta: ${char.name}`); else await reply(ctx,text,{mentions:[target]})
}

async function profileSettingHandler(ctx, mode) {
  const args=argsWithoutMentions(ctx); const result=withGachaState(state=>{const u=userOf(state,ctx.sender)
    if(mode==='bio') u.profile.bio=clean(args.join(' ')).slice(0,140)
    else if(mode==='card'){const item=itemByArg(u,state,args.join(' ')); if(!item) throw new Error('Personaje no encontrado.'); u.profile.cardUid=item.uid}
    else if(mode==='title'){const title=clean(args.join(' ')); if(!u.titles.includes(title)) throw new Error('Título no desbloqueado.'); u.profile.title=title}
    else if(mode==='badge'){const badge=clean(args.join(' ')); if(!u.badges.includes(badge)) throw new Error('Badge no desbloqueado.'); u.profile.badge=badge}
    else if(mode==='privacy'){const p=lower(args[0]); if(!['public','private'].includes(p)) throw new Error('Usa public o private.'); u.profile.privacy=p}
    return u.profile
  }); await reply(ctx,`✅ Perfil actualizado. ${result.badge} ${result.title}`)
}

async function titlesHandler(ctx) {const state=getGachaState(); const u=userOf(state,ctx.sender); await reply(ctx,`🏷️ Títulos: ${u.titles.join(', ')}\nActivo: ${u.profile.title}`)}

async function notificationHandler(ctx, field) {
  const value=lower(ctx.args?.[0]); if(!['on','off'].includes(value)) throw new Error(`Uso: ${prefixOf(ctx)}${field==='gacha'?'gachanotify':field+'notify'} on|off`)
  withGachaState(state=>{userOf(state,ctx.sender).notifications[field]=value==='on'})
  await reply(ctx,`🔔 ${field}: ${value==='on'?'activado':'desactivado'}.`)
}

async function groupConfigHandler(ctx, mode) {
  adminOnly(ctx)
  const args=argsWithoutMentions(ctx); const result=withGachaState(state=>{const g=groupOf(state,ctx.chat)
    if(mode==='enabled'){const v=lower(args[0]); if(!['on','off'].includes(v)) throw new Error('Usa on|off.'); g.enabled=v==='on'}
    else if(mode==='spawn'){const v=lower(args[0]); if(!['on','off'].includes(v)) throw new Error('Usa on|off.'); g.autoSpawn=v==='on'}
    else if(mode==='cooldown'){const n=Number(args[0]); if(args[0] && (!Number.isFinite(n)||n<10||n>3600)) throw new Error('Cooldown entre 10 y 3600 segundos.'); if(args[0]) g.cooldownSec=Math.floor(n)}
    else if(mode==='claimtime'){const n=Number(args[0]); if(!Number.isFinite(n)||n<15||n>600) throw new Error('Tiempo entre 15 y 600 segundos.'); g.claimTimeSec=Math.floor(n)}
    else if(mode==='channel') g.channel=ctx.chat
    else if(mode==='rules') g.rules=clean(args.join(' ')).slice(0,1000) || DEFAULT_GROUP.rules
    else if(mode==='reset') state.groups[ctx.chat]={...DEFAULT_GROUP}
    return groupOf(state,ctx.chat)
  })
  await reply(ctx,`⚙️ Gacha grupo\nActivo: ${result.enabled?'sí':'no'}\nAuto spawn: ${result.autoSpawn?'sí':'no'}\nCooldown: ${result.cooldownSec}s\nClaim: ${result.claimTimeSec}s`)
}

async function gachaCooldownHandler(ctx) {
  if(ctx.args?.length && isPrivileged(ctx)) return groupConfigHandler(ctx,'cooldown')
  const state=getGachaState(); const g=groupOf(state,ctx.chat); const left=Math.max(0,(g.lastRollAt||0)+g.cooldownSec*1000-now())
  await reply(ctx,`⏳ Cooldown del grupo: ${g.cooldownSec}s\nDisponible en: ${Math.ceil(left/1000)}s.`)
}

async function rulesHandler(ctx) {const state=getGachaState(); await reply(ctx,`📜 *Reglas Gacha*\n${groupOf(state,ctx.chat).rules}`)}

const HELP = [
  ['🎴 Tiradas', '.w', '.claim / .c', '.reroll', '.skip', '.spawn', '.gachacooldown', '.lastspawn'],
  ['🧍 Personajes', '.character / .char', '.lookup', '.series', '.rarity', '.randomchar', '.compare', '.value', '.ownerof', '.copies', '.gachaid'],
  ['💞 Colección', '.harem / .collection', '.inventory', '.characters', '.rarities', '.duplicates', '.recent', '.oldest', '.best', '.rarest', '.collectionvalue', '.completion', '.seriescompletion'],
  ['❤️ Favoritos', '.fav', '.unfav', '.favs', '.favorite', '.setfavorite', '.lock', '.unlock', '.locked'],
  ['💖 Wishlist', '.wish', '.unwish', '.wishlist', '.wishclear', '.wishmatch', '.wishspawn'],
  ['🪙 Economía', '.balance / .bal / .wallet', '.daily', '.weekly', '.monthly', '.work', '.gachajob', '.reward', '.claimreward', '.transactions', '.networth', '.pay', '.rich'],
  ['🎟️ Objetos', '.tickets', '.ticketshop', '.buyticket', '.use', '.items', '.boosters', '.usebooster', '.luck', '.pity', '.pityinfo', '.guaranteed'],
  ['🤝 Trades', '.trade', '.tradeadd', '.tradecoins', '.traderemove', '.tradeview', '.tradeaccept', '.tradedecline', '.tradecancel', '.trades', '.tradehistory'],
  ['🎁 Regalos', '.give', '.givecoins', '.gift', '.gifts', '.acceptgift'],
  ['💵 Venta', '.sell', '.sellall', '.sellduplicates', '.sellpreview', '.sellconfirm', '.sellcancel'],
  ['🏪 Mercado', '.market', '.marketsearch', '.marketlist', '.marketremove', '.marketbuy', '.mylistings', '.marketrecent', '.marketvalue'],
  ['🔨 Subastas', '.auction', '.bid', '.auctions', '.myauctions', '.auctioninfo', '.auctioncancel'],
  ['💞 Afinidad', '.affinity', '.interact', '.feed', '.giftchar', '.date', '.profilechar', '.nicknamechar', '.maxaffinity', '.marry', '.divorce', '.partner', '.marriage'],
  ['🧬 Mejoras', '.level', '.upgrade', '.evolve', '.ascend', '.xp', '.feedxp', '.stats', '.max', '.materials'],
  ['⚔️ Equipos/PvE', '.team', '.teamadd', '.teamremove', '.teamset', '.teamclear', '.teampower', '.teams', '.saveteam', '.loadteam', '.battle', '.boss', '.attack', '.dungeon', '.adventure', '.expedition', '.expeditions', '.claimexpedition'],
  ['🏆 Rankings/Stats', '.topgacha', '.topvalue', '.toprarity', '.topclaims', '.topcoins', '.topcompletion', '.topwishlist', '.topcharacter', '.topseries', '.gachastats', '.claims', '.rolls', '.luckstats', '.bestpull', '.worstluck', '.spent', '.earned', '.tradestats'],
  ['🏅 Logros', '.achievements', '.achievement', '.claimachievement', '.badges', '.badge'],
  ['🎊 Eventos', '.gachaevent', '.eventroll', '.eventshop', '.eventpoints', '.eventranking', '.eventmissions', '.eventclaim', '.banner', '.banners', '.bannerinfo', '.redeem', '.codes'],
  ['👤 Perfil', '.gachaprofile', '.setbio', '.setcard', '.settitle', '.titles', '.setbadge', '.gachaprivacy', '.gachanotify', '.wishnotify', '.tradenotify', '.marketnotify', '.eventnotify'],
  ['👥 Grupo', '.gacha on|off', '.gachaspawn on|off', '.gachacooldown <seg>', '.claimtime <seg>', '.gachachannel', '.gacharules', '.gacharesetgroup'],
  ['👑 Owner', '.addcharacter', '.editcharacter', '.delcharacter', '.givechar', '.removechar', '.addcoins', '.removecoins', '.addticket', '.removeticket', '.giveitem', '.removeitem', '.setrarity', '.setvalue', '.createbanner', '.editbanner', '.deletebanner', '.createevent', '.endevent', '.createcode', '.deletecode', '.gachaban', '.gachaunban', '.gachabanned', '.resetusergacha', '.resetgroupgacha', '.gachadbcheck', '.gachabackup', '.gachastatus']
]

async function gachaInfoHandler(ctx) {
  const p = prefixOf(ctx)
  const lines = HELP.flatMap(([title, ...cmds]) => [
    title,
    ...cmds.map(c => `• ${c.replace(/\./g, p)}`),
    ''
  ])
  await reply(ctx, ['🎴 *NERO GACHA — MEGA SISTEMA*', '', `${p}w mezcla todos los personajes: no hay waifu/husbando separados.`, '', ...lines].join('\n'))
}

async function ownerCharacterHandler(ctx, mode) {
  ownerOnly(ctx)
  const args=argsWithoutMentions(ctx)
  if(mode==='add'){
    const raw=args.join(' ').split('|').map(x=>x.trim()); const [name,series,image,rarityRaw,valueRaw]=raw
    if(!name||!series||!image) throw new Error('Uso: .addcharacter nombre | serie | imagen | rareza | valor')
    const char=normalizeCharacter({}, {id:`custom-${Date.now().toString(36)}`,name,series,image,rarity:Number(rarityRaw)||3,value:Number(valueRaw)||500,source:'custom'})
    withGachaState(state=>{state.catalog[char.id]=char}); await reply(ctx,`✅ Añadido ${char.name} (${char.id}).`); return
  }
  const id=args[0]; if(!id) throw new Error('Indica el ID.')
  if(mode==='delete'){withGachaState(state=>{if(!state.catalog[id]) throw new Error('No existe.'); delete state.catalog[id]}); await reply(ctx,`🗑️ Eliminado ${id}.`); return}
  const field=args[1]; const value=args.slice(2).join(' '); if(!field||!value) throw new Error('Uso: .editcharacter <id> <campo> <valor>')
  const allowed=['name','series','image','rarity','value','limited','event']
  if(!allowed.includes(field)) throw new Error(`Campos: ${allowed.join(', ')}`)
  withGachaState(state=>{const char=state.catalog[id]; if(!char) throw new Error('No existe.'); char[field]=['rarity','value'].includes(field)?Number(value):field==='limited'?value==='true':value})
  await reply(ctx,`✅ ${id}.${field} actualizado.`)
}

async function ownerGiveCharHandler(ctx, remove=false) {
  ownerOnly(ctx); const target=targetJid(ctx); const arg=argsWithoutMentions(ctx)[0]; if(!target||!arg) throw new Error(`Uso: ${prefixOf(ctx)}${remove?'removechar':'givechar'} @user <charId|uid>`)
  const result=withGachaState(state=>{const u=userOf(state,target)
    if(remove){const item=itemByArg(u,state,arg); if(!item) throw new Error('Copia no encontrada.'); u.collection=u.collection.filter(x=>x.uid!==item.uid); return charForItem(state,item)}
    const char=state.catalog[arg]||catalogMatch(state,arg); if(!char) throw new Error('Personaje no encontrado.'); u.collection.push({uid:instanceId(),charId:char.id,rarity:char.rarity,obtainedAt:now(),source:'owner',level:1,xp:0,affinity:0,nickname:'',locked:false,evolution:0,ascension:0}); return char
  }); await reply(ctx,`${remove?'🗑️ Retirado':'🎁 Entregado'}: ${result?.name} a ${mention(target)}.`,{mentions:[target]})
}

async function ownerEconomyHandler(ctx, mode) {
  ownerOnly(ctx); const target=targetJid(ctx); const args=argsWithoutMentions(ctx); const amount=Math.floor(Number(args[0])||0); if(!target||amount<=0) throw new Error('Menciona usuario e indica cantidad.')
  withGachaState(state=>{const u=userOf(state,target)
    if(mode==='addcoins') addCoins(u,amount,'Owner'); else if(mode==='removecoins') {u.coins=Math.max(0,u.coins-amount)}
    else if(mode==='addticket') u.tickets+=amount; else if(mode==='removeticket') u.tickets=Math.max(0,u.tickets-amount)
  }); await reply(ctx,`✅ ${mode}: ${amount} para ${mention(target)}.`,{mentions:[target]})
}

async function ownerItemHandler(ctx, remove=false) {
  ownerOnly(ctx); const target=targetJid(ctx); const args=argsWithoutMentions(ctx); const item=lower(args[0]); const qty=Math.max(1,Number(args[1])||1); if(!target||!item) throw new Error('Uso: .giveitem @user <item> [cantidad]')
  withGachaState(state=>{const u=userOf(state,target); u.items[item]=Math.max(0,(u.items[item]||0)+(remove?-qty:qty))}); await reply(ctx,`✅ ${item}: ${remove?'-':'+'}${qty} para ${mention(target)}.`,{mentions:[target]})
}

async function ownerCharValueHandler(ctx, field) {
  ownerOnly(ctx); const [id,val]=argsWithoutMentions(ctx); if(!id||!val) throw new Error(`Uso: .${field==='rarity'?'setrarity':'setvalue'} <id> <valor>`)
  withGachaState(state=>{const c=state.catalog[id]; if(!c) throw new Error('No existe.'); c[field]=field==='rarity'?clamp(Number(val),1,6):Math.max(1,Number(val))}); await reply(ctx,'✅ Actualizado.')
}

async function ownerBannerHandler(ctx, mode) {
  ownerOnly(ctx); const raw=argsWithoutMentions(ctx).join(' ')
  if(mode==='create'){const [id,name,chars]=raw.split('|').map(x=>x.trim()); if(!id||!name) throw new Error('Uso: .createbanner id | nombre | charId1,charId2'); withGachaState(s=>{s.banners[id]={id,name,characterIds:(chars||'').split(',').map(x=>x.trim()).filter(Boolean),active:true,createdAt:now()}}); await reply(ctx,`✅ Banner ${id} creado.`);return}
  const [id,...rest]=argsWithoutMentions(ctx); if(!id) throw new Error('Indica banner.')
  if(mode==='delete') withGachaState(s=>{delete s.banners[id]})
  else withGachaState(s=>{const b=s.banners[id]; if(!b) throw new Error('No existe.'); const [field,...parts]=rest; if(field==='name') b.name=parts.join(' '); else if(field==='characters') b.characterIds=parts.join(' ').split(',').map(x=>x.trim()).filter(Boolean); else if(field==='active') b.active=parts[0]==='true'; else throw new Error('Campos: name, characters, active')})
  await reply(ctx,`✅ Banner ${id} actualizado.`)
}

async function ownerEventHandler(ctx, end=false) {
  ownerOnly(ctx)
  if(end){const id=argsWithoutMentions(ctx)[0]; withGachaState(s=>{const e=s.events[id]||Object.values(s.events).find(x=>x.active); if(!e) throw new Error('Evento no encontrado.'); e.active=false; e.endedAt=now()}); await reply(ctx,'✅ Evento finalizado.');return}
  const [id,name,bannerId,durationHoursRaw]=argsWithoutMentions(ctx).join(' ').split('|').map(x=>x.trim()); if(!id||!name) throw new Error('Uso: .createevent id | nombre | bannerId | horas')
  const hours=Number(durationHoursRaw)||168; withGachaState(s=>{for(const e of Object.values(s.events)) e.active=false; s.events[id]={id,name,bannerId:bannerId||null,active:true,createdAt:now(),endsAt:now()+hours*3600000}}); await reply(ctx,`✅ Evento ${name} creado.`)
}

async function ownerCodeHandler(ctx, remove=false) {
  ownerOnly(ctx); const args=argsWithoutMentions(ctx); const code=clean(args[0]).toUpperCase(); if(!code) throw new Error('Indica código.')
  if(remove){withGachaState(s=>{delete s.codes[code]}); await reply(ctx,`🗑️ Código ${code} eliminado.`);return}
  const coins=Math.max(0,Number(args[1])||0); const tickets=Math.max(0,Number(args[2])||0); const maxUses=Math.max(0,Number(args[3])||0); withGachaState(s=>{s.codes[code]={coins,tickets,maxUses:maxUses||null,usedBy:[],active:true,public:true,createdAt:now()}}); await reply(ctx,`✅ Código ${code} creado.`)
}

async function ownerBanHandler(ctx, remove=false) {
  ownerOnly(ctx); const target=targetJid(ctx); if(!target) throw new Error('Menciona usuario.')
  const reason=argsWithoutMentions(ctx).join(' ')||'Bloqueado por Owner'; withGachaState(s=>{const key=jidKey(target); if(remove) delete s.bans[key]; else s.bans[key]={reason,at:now()}}); await reply(ctx,`${remove?'✅ Desbloqueado':'🚫 Bloqueado'} ${mention(target)}.`,{mentions:[target]})
}

async function ownerBannedHandler(ctx) {ownerOnly(ctx); const state=getGachaState(); const rows=Object.entries(state.bans); await reply(ctx,['🚫 *Gacha bans*','',...(rows.length?rows.map(([jid,b])=>`${mention(jid)} • ${b.reason}`):['Ninguno.'])].join('\n'))}

async function ownerResetHandler(ctx, group=false) {
  ownerOnly(ctx); if(group){withGachaState(s=>{s.groups[ctx.chat]={...DEFAULT_GROUP}}); await reply(ctx,'✅ Configuración Gacha del grupo restablecida.'); return}
  const target=targetJid(ctx); if(!target) throw new Error('Menciona usuario.'); withGachaState(s=>{s.users[jidKey(target)]=defaultUser()}); await reply(ctx,`✅ Gacha de ${mention(target)} restablecido.`,{mentions:[target]})
}

async function dbCheckHandler(ctx) {ownerOnly(ctx); const state=getGachaState(); await reply(ctx,`🧪 *Gacha DB OK*\nRuta: ${gachaStatePath()}\nUsuarios: ${Object.keys(state.users).length}\nPersonajes: ${Object.keys(state.catalog).length}\nGrupos: ${Object.keys(state.groups).length}\nMercado: ${Object.values(state.market).filter(x=>x.status==='active').length}\nTrades: ${Object.values(state.trades).filter(x=>x.status==='open').length}`)}
async function backupHandler(ctx) {ownerOnly(ctx); const file=backupGachaState('owner'); await reply(ctx,`💾 Backup creado: ${file}`)}
async function statusHandler(ctx) {ownerOnly(ctx); const state=getGachaState(); await reply(ctx,`🎴 *Nero Gacha Status*\nRolls: ${state.global.rolls}\nClaims: ${state.global.claims}\nUsuarios: ${Object.keys(state.users).length}\nCatálogo: ${Object.keys(state.catalog).length}\nSpawns activos: ${Object.keys(state.activeSpawns).length}\nBoss: ${state.boss?.name||'no inicializado'}`)}


let gachaSchedulerTimer = null
let gachaSchedulerBusy = false

export function startGachaScheduler(sock) {
  if (gachaSchedulerTimer) clearInterval(gachaSchedulerTimer)

  const tick = async () => {
    if (gachaSchedulerBusy || !sock?.user) return
    gachaSchedulerBusy = true
    try {
      const snapshot = getGachaState()
      const chats = Object.entries(snapshot.groups)
        .filter(([chat, group]) => chat.endsWith('@g.us') && group?.enabled && group?.autoSpawn)
        .map(([chat]) => chat)

      for (const chat of chats) {
        const member = await sock.groupMetadata(chat).then(() => true).catch(() => false)
        if (!member) continue

        const claimed = withGachaState(state => {
          cleanupExpired(state)
          const group = groupOf(state, chat)
          if (!group.enabled || !group.autoSpawn) return false
          if (state.activeSpawns[chat]) return false
          const every = Math.max(300, Number(group.autoSpawnEverySec || 900))
          if ((group.lastAutoSpawnAt || 0) + every * 1000 > now()) return false
          group.lastAutoSpawnAt = now()
          return true
        })
        if (!claimed) continue

        try {
          const char = await fetchRandomCharacter()
          const saved = withGachaState(state => {
            const group = groupOf(state, chat)
            if (!group.enabled || !group.autoSpawn || state.activeSpawns[chat]) return null
            state.catalog[char.id] = normalizeCharacter(char)
            group.lastSpawn = char.id
            state.activeSpawns[chat] = {
              id: txId('autospawn'),
              charId: char.id,
              spawnedBy: 'nero-auto',
              createdAt: now(),
              expiresAt: now() + group.claimTimeSec * 1000,
              automatic: true
            }
            return { char: state.catalog[char.id], claimTimeSec: group.claimTimeSec }
          })
          if (!saved) continue
          const caption = [
            '🎴 *NERO GACHA • APARICIÓN AUTOMÁTICA*',
            '',
            `✨ ${saved.char.name}`,
            `📺 ${saved.char.series}`,
            `⭐ ${stars(saved.char.rarity)}`,
            `💰 ${money(saved.char.value)} monedas`,
            `🆔 ${saved.char.id}`,
            '',
            `Usa *${config.prefix || '.'}claim* para reclamar.`,
            `⏳ ${saved.claimTimeSec}s`
          ].join('\n')
          const payload = saved.char.image
            ? { image: { url: saved.char.image }, caption }
            : { text: caption }
          await sock.sendMessage(chat, payload).catch(async () => {
            await sock.sendMessage(chat, {
              text: `🎴 *${saved.char.name}* apareció automáticamente.\n${stars(saved.char.rarity)} • Usa ${(config.prefix || '.')}claim`
            }).catch(() => {})
          })
        } catch (error) {
          console.warn('[GACHA AUTOSPAWN]', error?.message || error)
        }
      }
    } finally {
      gachaSchedulerBusy = false
    }
  }

  gachaSchedulerTimer = setInterval(() => tick().catch(() => {}), 60_000)
  gachaSchedulerTimer.unref?.()
  setTimeout(() => tick().catch(() => {}), 10_000).unref?.()
  return () => {
    if (gachaSchedulerTimer) clearInterval(gachaSchedulerTimer)
    gachaSchedulerTimer = null
  }
}

function command(name, execute, aliases = []) {
  return { name, aliases, async execute(ctx) {
    try {
      withGachaState(state => cleanupExpired(state))
      await execute(ctx)
    } catch (error) {
      console.error(`[GACHA:${name}]`, error)
      await reply(ctx, `❌ ${error?.message || error}`).catch(() => {})
    }
  } }
}

export const gachaCommands = [
  command('w', rollHandler, ['roll','spawn']),
  command('claim', claimHandler, ['c']), command('reroll', rerollHandler), command('skip', skipHandler),
  command('gachacooldown', gachaCooldownHandler), command('lastspawn', lastSpawnHandler),
  command('character', characterHandler, ['char']), command('lookup', lookupHandler), command('series', seriesHandler), command('rarity', rarityHandler), command('randomchar', randomCharHandler), command('compare', compareHandler), command('value', valueHandler), command('ownerof', ownerOfHandler), command('copies', copiesHandler), command('gachaid', gachaIdHandler),
  command('harem', haremHandler, ['collection']), command('inventory', ctx=>collectionSummaryHandler(ctx,'inventory')), command('characters', ctx=>collectionSummaryHandler(ctx,'characters')), command('rarities', raritiesSummaryHandler), command('duplicates', ctx=>collectionSummaryHandler(ctx,'duplicates')), command('recent', ctx=>collectionSummaryHandler(ctx,'recent')), command('oldest', ctx=>collectionSummaryHandler(ctx,'oldest')), command('best', ctx=>collectionSummaryHandler(ctx,'best')), command('rarest', ctx=>collectionSummaryHandler(ctx,'rarest')), command('collectionvalue', collectionValueHandler), command('completion', completionHandler), command('seriescompletion', seriesCompletionHandler),
  command('fav', ctx=>favoriteHandler(ctx,'fav')), command('unfav', ctx=>favoriteHandler(ctx,'unfav')), command('favs', favsHandler), command('favorite', favoriteCurrentHandler), command('setfavorite', ctx=>favoriteHandler(ctx,'setfavorite')), command('lock', ctx=>favoriteHandler(ctx,'lock')), command('unlock', ctx=>favoriteHandler(ctx,'unlock')), command('locked', ctx=>favsHandler(ctx,true)),
  command('wish', ctx=>wishHandler(ctx,false)), command('unwish', ctx=>wishHandler(ctx,true)), command('wishlist', wishlistHandler), command('wishclear', wishClearHandler), command('wishmatch', wishMatchHandler), command('wishspawn', wishSpawnHandler),
  command('balance', balanceHandler, ['bal','wallet','networth']), command('daily', ctx=>timedReward(ctx,'daily',86400000,500,'Daily')), command('weekly', ctx=>timedReward(ctx,'weekly',7*86400000,2500,'Weekly')), command('monthly', ctx=>timedReward(ctx,'monthly',30*86400000,10000,'Monthly')), command('work', ctx=>workHandler(ctx,false)), command('gachajob', ctx=>workHandler(ctx,true)), command('reward', ctx=>rewardsHandler(ctx,false)), command('claimreward', ctx=>rewardsHandler(ctx,true)), command('transactions', transactionsHandler), command('pay', payHandler), command('rich', richHandler),
  command('tickets', ticketsHandler), command('ticketshop', ticketShopHandler), command('buyticket', buyTicketHandler), command('use', useItemHandler, ['usebooster']), command('items', itemsHandler), command('boosters', boostersHandler), command('luck', luckHandler), command('pity', ctx=>pityHandler(ctx,false)), command('pityinfo', ctx=>pityHandler(ctx,true)), command('guaranteed', ctx=>pityHandler(ctx,false)),
  command('trade', tradeStartHandler), command('tradeadd', ctx=>tradeModifyHandler(ctx,'add')), command('tradecoins', ctx=>tradeModifyHandler(ctx,'coins')), command('traderemove', ctx=>tradeModifyHandler(ctx,'remove')), command('tradeview', tradeViewHandler), command('tradeaccept', tradeAcceptHandler), command('tradedecline', ctx=>tradeEndHandler(ctx,true)), command('tradecancel', ctx=>tradeEndHandler(ctx,false)), command('trades', ctx=>tradesHandler(ctx,false)), command('tradehistory', ctx=>tradesHandler(ctx,true)),
  command('give', giveHandler), command('givecoins', giveCoinsHandler), command('gift', giftBoxHandler), command('gifts', ctx=>giftsHandler(ctx,false)), command('acceptgift', ctx=>giftsHandler(ctx,true)),
  command('sell', ctx=>sellPrepareHandler(ctx,false)), command('sellpreview', ctx=>sellPrepareHandler(ctx,true)), command('sellconfirm', sellConfirmHandler), command('sellcancel', sellCancelHandler), command('sellall', ctx=>sellBulkHandler(ctx,false)), command('sellduplicates', ctx=>sellBulkHandler(ctx,true)),
  command('market', ctx=>marketHandler(ctx,'list')), command('marketsearch', ctx=>marketHandler(ctx,'search')), command('marketlist', marketListHandler), command('marketremove', marketRemoveHandler), command('marketbuy', marketBuyHandler), command('mylistings', ctx=>marketHandler(ctx,'mine')), command('marketrecent', marketRecentHandler), command('marketvalue', marketValueHandler),
  command('auction', auctionCreateHandler), command('bid', bidHandler), command('auctions', ctx=>auctionsHandler(ctx,false)), command('myauctions', ctx=>auctionsHandler(ctx,true)), command('auctioninfo', auctionInfoHandler), command('auctioncancel', auctionCancelHandler),
  command('affinity', affinityHandler), command('interact', ctx=>affinityActionHandler(ctx,'interact')), command('feed', ctx=>affinityActionHandler(ctx,'feed')), command('giftchar', ctx=>affinityActionHandler(ctx,'giftchar')), command('date', ctx=>affinityActionHandler(ctx,'date')), command('profilechar', profileCharHandler), command('nicknamechar', nicknameCharHandler), command('maxaffinity', maxAffinityHandler), command('marry', marryHandler), command('divorce', divorceHandler), command('partner', partnerHandler, ['marriage']),
  command('level', levelHandler, ['xp']), command('upgrade', ctx=>upgradeHandler(ctx,'upgrade')), command('evolve', ctx=>upgradeHandler(ctx,'evolve')), command('ascend', ctx=>upgradeHandler(ctx,'ascend')), command('feedxp', feedXpHandler), command('stats', statsCharHandler), command('max', ctx=>upgradeHandler(ctx,'max')), command('materials', materialsHandler),
  command('team', teamHandler), command('teamadd', ctx=>teamModifyHandler(ctx,'add')), command('teamremove', ctx=>teamModifyHandler(ctx,'remove')), command('teamset', ctx=>teamModifyHandler(ctx,'set')), command('teamclear', ctx=>teamModifyHandler(ctx,'clear')), command('teampower', teamHandler), command('teams', teamsHandler), command('saveteam', ctx=>teamModifyHandler(ctx,'save')), command('loadteam', ctx=>teamModifyHandler(ctx,'load')),
  command('battle', ctx=>pveHandler(ctx,'battle')), command('boss', ctx=>bossHandler(ctx,false)), command('attack', ctx=>bossHandler(ctx,true)), command('dungeon', ctx=>pveHandler(ctx,'dungeon')), command('adventure', ctx=>pveHandler(ctx,'adventure')), command('expedition', expeditionHandler), command('expeditions', expeditionsHandler), command('claimexpedition', claimExpeditionHandler),
  command('topgacha', ctx=>topHandler(ctx,'topgacha')), command('topvalue', ctx=>topHandler(ctx,'topvalue')), command('toprarity', ctx=>topHandler(ctx,'toprarity')), command('topclaims', ctx=>topHandler(ctx,'topclaims')), command('topcoins', ctx=>topHandler(ctx,'topcoins')), command('topcompletion', ctx=>topHandler(ctx,'topcompletion')), command('topwishlist', ctx=>topHandler(ctx,'topwishlist')), command('topcharacter', topCharacterHandler), command('topseries', topSeriesHandler),
  command('gachastats', gachaStatsHandler), command('claims', ctx=>simpleStatHandler(ctx,'claims')), command('rolls', ctx=>simpleStatHandler(ctx,'rolls')), command('luckstats', ctx=>simpleStatHandler(ctx,'luckstats')), command('bestpull', ctx=>simpleStatHandler(ctx,'bestpull')), command('worstluck', ctx=>simpleStatHandler(ctx,'worstluck')), command('spent', ctx=>simpleStatHandler(ctx,'spent')), command('earned', ctx=>simpleStatHandler(ctx,'earned')), command('tradestats', ctx=>simpleStatHandler(ctx,'tradestats')),
  command('achievements', achievementsHandler), command('achievement', achievementHandler), command('claimachievement', claimAchievementHandler), command('badges', badgesHandler), command('badge', badgeHandler),
  command('gachaevent', ctx=>eventHandler(ctx,'event')), command('eventroll', eventRollHandler), command('eventshop', ctx=>eventHandler(ctx,'shop')), command('eventpoints', ctx=>eventHandler(ctx,'points')), command('eventranking', ctx=>eventHandler(ctx,'ranking')), command('eventmissions', ctx=>eventHandler(ctx,'missions')), command('eventclaim', ctx=>eventHandler(ctx,'claim')), command('banner', ctx=>bannersHandler(ctx,true)), command('banners', ctx=>bannersHandler(ctx,false)), command('bannerinfo', ctx=>bannersHandler(ctx,true)), command('redeem', redeemHandler), command('codes', codesHandler),
  command('gachaprofile', gachaProfileHandler), command('setbio', ctx=>profileSettingHandler(ctx,'bio')), command('setcard', ctx=>profileSettingHandler(ctx,'card')), command('settitle', ctx=>profileSettingHandler(ctx,'title')), command('titles', titlesHandler), command('setbadge', ctx=>profileSettingHandler(ctx,'badge')), command('gachaprivacy', ctx=>profileSettingHandler(ctx,'privacy')),
  command('gachanotify', ctx=>notificationHandler(ctx,'gacha')), command('wishnotify', ctx=>notificationHandler(ctx,'wish')), command('tradenotify', ctx=>notificationHandler(ctx,'trade')), command('marketnotify', ctx=>notificationHandler(ctx,'market')), command('eventnotify', ctx=>notificationHandler(ctx,'event')),
  command('gacha', ctx=>groupConfigHandler(ctx,'enabled')), command('gachaspawn', ctx=>groupConfigHandler(ctx,'spawn')), command('claimtime', ctx=>groupConfigHandler(ctx,'claimtime')), command('gachachannel', ctx=>groupConfigHandler(ctx,'channel')), command('gacharules', rulesHandler), command('gacharesetgroup', ctx=>groupConfigHandler(ctx,'reset')), command('gachainfo', gachaInfoHandler),
  command('addcharacter', ctx=>ownerCharacterHandler(ctx,'add')), command('editcharacter', ctx=>ownerCharacterHandler(ctx,'edit')), command('delcharacter', ctx=>ownerCharacterHandler(ctx,'delete')), command('givechar', ctx=>ownerGiveCharHandler(ctx,false)), command('removechar', ctx=>ownerGiveCharHandler(ctx,true)),
  command('addcoins', ctx=>ownerEconomyHandler(ctx,'addcoins')), command('removecoins', ctx=>ownerEconomyHandler(ctx,'removecoins')), command('addticket', ctx=>ownerEconomyHandler(ctx,'addticket')), command('removeticket', ctx=>ownerEconomyHandler(ctx,'removeticket')), command('giveitem', ctx=>ownerItemHandler(ctx,false)), command('removeitem', ctx=>ownerItemHandler(ctx,true)), command('setrarity', ctx=>ownerCharValueHandler(ctx,'rarity')), command('setvalue', ctx=>ownerCharValueHandler(ctx,'value')),
  command('createbanner', ctx=>ownerBannerHandler(ctx,'create')), command('editbanner', ctx=>ownerBannerHandler(ctx,'edit')), command('deletebanner', ctx=>ownerBannerHandler(ctx,'delete')), command('createevent', ctx=>ownerEventHandler(ctx,false)), command('endevent', ctx=>ownerEventHandler(ctx,true)), command('createcode', ctx=>ownerCodeHandler(ctx,false)), command('deletecode', ctx=>ownerCodeHandler(ctx,true)),
  command('gachaban', ctx=>ownerBanHandler(ctx,false)), command('gachaunban', ctx=>ownerBanHandler(ctx,true)), command('gachabanned', ownerBannedHandler), command('resetusergacha', ctx=>ownerResetHandler(ctx,false)), command('resetgroupgacha', ctx=>ownerResetHandler(ctx,true)), command('gachadbcheck', dbCheckHandler), command('gachabackup', backupHandler), command('gachastatus', statusHandler)
]
