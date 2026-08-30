import { command as menu } from './menu.js'
import { command as ping } from './ping.js'
import { speedtestCommand } from './speedtest.js'
import { command as info } from './info.js'
import { downloadCommands } from './downloads.js'
import { toolCommands } from './tools.js'
import { moderationCommands } from './moderation.js'
import { testCarousel, testModernInteractive } from './debug.js'
import { aiCommands } from './ai.js'
import { animeCommands } from './anime.js'
import { ownerCommands } from './owner.js'
import { safeOwnerCommands } from './owner-safe.js'
import { reportCommand } from './report.js'
import { supportCommand } from './support.js'
import { subbotCommands } from './subbots.js'
import { identityCommands } from './identity.js'
import { modeCommands } from './mode.js'
import { favoriteCommands } from './favorites.js'
import { reactionCommands } from './reactions.js'
import { nsfwCommands } from './nsfw.js'
import { stalkingCommands } from './stalking.js'
import { stickerCommands } from './stickers.js'
import { generatorCommands } from './generators.js'
import { extraSearchCommands } from './extra-search.js'
import { peruLookupCommands } from './peru.js'
import { extraUtilityCommands } from './extra-utils.js'
import { animeEvoCommands } from './anime-evo.js'
import { gachaCommands } from './gacha.js'
import { salesCommands } from './sales.js'
import { serverCommand } from './server.js'
import { gameCommands } from './games.js'
import { movieCommands } from './movies.js'
import { animeLatinoCommands } from './animelatino.js'
import { movie2Commands } from './movies2.js'

const commands = [
  menu,
  ping,
  speedtestCommand,
  info,
  serverCommand,
  ...gameCommands,
  ...movieCommands,
  ...movie2Commands,
  ...salesCommands,
  reportCommand,
  supportCommand,
  ...modeCommands,
  ...favoriteCommands,
  ...reactionCommands,
  ...animeEvoCommands,
  ...gachaCommands,
  ...subbotCommands,
  ...identityCommands,
  ...downloadCommands,
  ...extraSearchCommands,
  ...peruLookupCommands,
  ...toolCommands,
  ...extraUtilityCommands,
  ...generatorCommands,
  ...stickerCommands,
  ...aiCommands,
  ...animeCommands,
  ...animeLatinoCommands,
  ...stalkingCommands,
  ...nsfwCommands,
  ...moderationCommands,
  ...ownerCommands,
  ...safeOwnerCommands
]

const commandMap = new Map()
for (const command of commands) {
  commandMap.set(command.name, command)
  for (const alias of command.aliases || []) commandMap.set(alias, command)
}

export function findCommand(name) {
  return commandMap.get(String(name || '').toLowerCase())
}

const SUGGESTION_OVERRIDES = {
  spotifypick: 'spotifydl',
  spotifydown: 'spotifydl',
  spotifydownload: 'spotifydl',
  ytmusicpick: 'ytmusic',
  ytaudiopick: 'play',
  animepick: 'anime',
  animequery: 'anime',
  peliculapick: 'pelicula'
}

function levenshtein(a = '', b = '') {
  const x = String(a)
  const y = String(b)
  const row = Array.from({ length: y.length + 1 }, (_, i) => i)

  for (let i = 1; i <= x.length; i += 1) {
    let previous = row[0]
    row[0] = i

    for (let j = 1; j <= y.length; j += 1) {
      const current = row[j]
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (x[i - 1] === y[j - 1] ? 0 : 1)
      )
      previous = current
    }
  }

  return row[y.length]
}

function commonPrefixLength(a = '', b = '') {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a[i] === b[i]) i += 1
  return i
}

export function suggestCommand(name) {
  const raw = String(name || '').toLowerCase().trim()
  if (!raw) return ''

  if (SUGGESTION_OVERRIDES[raw]) {
    return SUGGESTION_OVERRIDES[raw]
  }

  const prefixSuggestions = [
    [/^spo/i, 'spotify'],
    [/^ytm/i, 'ytmusic'],
    [/^yts/i, 'ytsearch'],
    [/^ani/i, 'anime'],
    [/^peli/i, 'pelicula'],
    [/^tiktok/i, 'tiktok'],
    [/^insta/i, 'instagram']
  ]

  for (const [pattern, suggestion] of prefixSuggestions) {
    if (pattern.test(raw)) return suggestion
  }

  const internal = /(?:pick|query|get|episode)$/i
  const entries = []

  for (const command of commands) {
    const canonical = String(command?.name || '').toLowerCase()
    if (!canonical || internal.test(canonical)) continue

    const keys = [
      canonical,
      ...(command.aliases || []).map(value =>
        String(value || '').toLowerCase()
      )
    ]

    for (const key of keys) {
      if (!key || internal.test(key)) continue
      entries.push({ key, canonical })
    }
  }

  for (const entry of entries) {
    if (
      entry.key.length >= 2 &&
      raw.startsWith(entry.key) &&
      /^(?:https?:|www\.)/i.test(raw.slice(entry.key.length))
    ) {
      return entry.canonical
    }
  }

  let best = null

  for (const entry of entries) {
    if (entry.key.length < 3 && raw.length > 3) continue

    const maxLength = Math.max(raw.length, entry.key.length)
    const distance = levenshtein(raw, entry.key)
    const similarity = maxLength
      ? 1 - (distance / maxLength)
      : 0

    const prefixLength = commonPrefixLength(raw, entry.key)
    const prefixScore = prefixLength /
      Math.max(1, Math.min(raw.length, entry.key.length))

    const contains =
      raw.includes(entry.key) ||
      entry.key.includes(raw)

    const score =
      similarity * 0.72 +
      prefixScore * 0.22 +
      (contains ? 0.10 : 0)

    if (!best || score > best.score) {
      best = {
        ...entry,
        score,
        prefixScore,
        distance
      }
    }
  }

  if (!best) return ''

  const accepted =
    best.score >= 0.50 ||
    (
      best.prefixScore >= 0.35 &&
      best.score >= 0.36 &&
      best.distance <= Math.max(
        4,
        Math.ceil(Math.max(raw.length, best.key.length) * 0.60)
      )
    )

  return accepted ? best.canonical : ''
}
