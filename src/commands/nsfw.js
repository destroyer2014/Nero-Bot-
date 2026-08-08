import { jidNormalizedUser } from '@itsliaaa/baileys'
import config from '../../config.js'
import { evoGet } from '../lib/api.js'
import { getGroup, patchGroup } from '../lib/groupStore.js'
import { sendInteractive, singleSelect } from '../lib/interactive.js'
import { getSelection, saveSelection } from '../lib/selectionCache.js'

const interactionTypes = [
  'spank', 'undress', 'yuri', 'sixnine', 'anal', 'fuck', 'cummouth',
  'suckboobs', 'cumshot', 'lickpussy', 'lickdick', 'lickass', 'handjob',
  'grope', 'cum', 'grabboobs', 'blowjob', 'boobjob', 'fap', 'footjob',
  'fingering', 'creampie', 'facesitting', 'futanari', 'pegging', 'bondage',
  'deepthroat', 'thighjob', 'yaoi', 'bukkake', 'orgy', 'squirting'
]

const randomTypes = [
  'waifu', 'hentai', 'neko', 'boobs', 'bigboobs', 'pussy', 'ass', 'bikini',
  'maid', 'bunny', 'wet', 'dick', 'yuri', 'lesbian', 'futa'
]

const blockedTerms = [
  /\b(child|children|kid|kids|minor|minors|underage|preteen|teen|teenager)\b/i,
  /\b(loli|lolicon|shota|shotacon|schoolgirl|schoolboy|colegiala|colegial)\b/i,
  /\b(niñ[oa]s?|menor(?:es)?|adolescente(?:s)?|beb[eé]s?)\b/i,
  /\b(rape|raped|forced|non[- ]?consensual|abuse|molestation|kidnap(?:ped)?)\b/i,
  /\b(violaci[oó]n|forzad[oa]s?|sin consentimiento|abus[oa]|secuestrad[oa]s?)\b/i,
  /\b(hidden[- ]?cam|spy[- ]?cam|voyeur|revenge[- ]?porn|sleeping|unconscious|drugged)\b/i,
  /\b(c[aá]mara oculta|espiad[oa]|inconsciente|drogad[oa])\b/i,
  /\b(bestiality|zoophilia|animal sex|snuff)\b/i,
  /\b(bestialismo|zoofilia)\b/i
]

const normalizeHandle = value => String(value || '').trim().replace(/^@/, '')
const jidToken = value => String(value || '').replace(/:\d+@/, '@').split('@')[0].split(':')[0]
const sameIdentity = (a, b) => {
  if (!a || !b) return false
  const na = jidNormalizedUser(String(a))
  const nb = jidNormalizedUser(String(b))
  return na === nb || jidToken(na) === jidToken(nb)
}

function participantValues(participant = {}) {
  return [participant.id, participant.jid, participant.lid, participant.phoneNumber]
    .filter(Boolean)
    .map(String)
}

async function requireGroupAdmin(ctx) {
  if (!ctx.chat.endsWith('@g.us')) throw new Error('Esta función solo está disponible en grupos.')
  const metadata = await ctx.sock.groupMetadata(ctx.chat)
  const participant = (metadata.participants || []).find(entry =>
    participantValues(entry).some(value => sameIdentity(value, ctx.sender))
  )
  if (!participant?.admin && !ctx.isOwner && !ctx.isSubOwner) {
    throw new Error('Solo los administradores pueden cambiar la sección NSFW.')
  }
  return metadata
}

function requireAdultEnabled(ctx) {
  if (!ctx.chat.endsWith('@g.us')) {
    throw new Error('Los comandos NSFW solo funcionan en grupos con autorización administrativa.')
  }
  if (!getGroup(ctx.chat).adultContent) {
    throw new Error('La sección NSFW está desactivada. Un administrador debe usar .nsfwactivar on.')
  }
}

function assertAllowedInput(value, label = 'búsqueda') {
  const text = String(value || '').trim()
  if (!text) throw new Error(`Debes indicar la ${label}.`)
  if (blockedTerms.some(pattern => pattern.test(text))) {
    throw new Error('La solicitud fue bloqueada por seguridad: no se permite contenido con menores, abuso, falta de consentimiento, cámaras ocultas, explotación ni animales.')
  }
  return text
}

function cleanText(value, fallback = 'No disponible') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text || fallback
}

function formatNumber(value) {
  const number = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(number) ? new Intl.NumberFormat('es-PE').format(number) : cleanText(value)
}

function extractMediaUrl(payload) {
  const candidates = [
    payload?.url,
    typeof payload?.result === 'string' ? payload.result : null,
    payload?.result?.url,
    payload?.result?.media,
    payload?.resultado?.url,
    payload?.resultado?.result?.url,
    payload?.data?.url,
    payload?.data?.media,
    payload?.image,
    payload?.video,
    payload?.file,
    payload?.download?.high,
    payload?.download?.low
  ]
  const listCandidates = [payload?.results, payload?.resultados, payload?.data, payload?.posts]
  for (const list of listCandidates) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const nested = extractMediaUrl(item)
      if (nested) return nested
    }
  }
  return candidates.find(value => typeof value === 'string' && /^https?:\/\//i.test(value)) || ''
}

async function fetchMedia(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('La API no devolvió un enlace multimedia válido.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': `${config.botName}/${config.version}` }
    })
    if (!response.ok) throw new Error(`No se pudo descargar el archivo multimedia (HTTP ${response.status}).`)
    const length = Number(response.headers.get('content-length') || 0)
    if (length && length > config.maxUploadBytes) throw new Error('El archivo supera el límite de tamaño configurado.')
    const buffer = Buffer.from(await response.arrayBuffer())
    if (!buffer.length) throw new Error('El archivo multimedia llegó vacío.')
    if (buffer.length > config.maxUploadBytes) throw new Error('El archivo supera el límite de tamaño configurado.')
    return { buffer, contentType: response.headers.get('content-type') || '' }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('La descarga tardó demasiado y fue cancelada.')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function sendMedia(ctx, url, kind, caption, { gifPlayback = false } = {}) {
  const { buffer, contentType } = await fetchMedia(url)
  if (kind === 'image') {
    await ctx.sock.sendMessage(ctx.chat, { image: buffer, caption }, { quoted: ctx.msg })
    return
  }
  await ctx.sock.sendMessage(ctx.chat, {
    video: buffer,
    mimetype: contentType.includes('video/') ? contentType.split(';')[0] : 'video/mp4',
    gifPlayback,
    caption
  }, { quoted: ctx.msg })
}

const wrap = (name, aliases, execute) => ({
  name,
  aliases,
  async execute(ctx) {
    try {
      await execute(ctx)
    } catch (error) {
      await ctx.sock.sendMessage(ctx.chat, { text: `❌ ${error?.message || 'No se pudo completar la solicitud.'}` }, { quoted: ctx.msg })
    }
  }
})

function searchResults(data) {
  if (Array.isArray(data?.resultados)) return data.resultados
  if (Array.isArray(data?.results)) return data.results
  if (Array.isArray(data?.result)) return data.result
  return []
}

function formatSearchResults(title, results) {
  if (!results.length) throw new Error('La API no encontró resultados para esa búsqueda.')
  const lines = [`🔞 *${title}*`, '']
  for (const [index, item] of results.slice(0, 8).entries()) {
    const details = [
      item.duration ? `Duración: ${cleanText(item.duration)}` : '',
      item.resolution ? `Calidad: ${cleanText(item.resolution).replace(/(\d+p)\1/i, '$1')}` : '',
      item.views !== undefined && item.views !== null ? `Vistas: ${formatNumber(item.views)}` : ''
    ].filter(Boolean).join(' • ')
    lines.push(`*${index + 1}.* ${cleanText(item.title, 'Sin título')}`)
    if (details) lines.push(`> ${details}`)
    if (item.url) lines.push(`> ${item.url}`)
    lines.push('')
  }
  lines.push('Descarga el resultado usando el comando correspondiente y su URL.')
  return lines.join('\n')
}

export const nsfwToggle = wrap('nsfwactivar', ['activar18', 'adultos'], async ctx => {
  await requireGroupAdmin(ctx)
  const action = String(ctx.args[0] || '').toLowerCase()
  if (!['on', 'off'].includes(action)) throw new Error('Uso: .nsfwactivar on/off')
  patchGroup(ctx.chat, { adultContent: action === 'on' })
  await ctx.sock.sendMessage(ctx.chat, {
    text: action === 'on'
      ? '🔞 La sección NSFW quedó activada para adultos en este grupo. Los administradores pueden desactivarla con .nsfwactivar off.'
      : '✅ La sección NSFW quedó desactivada en este grupo.'
  }, { quoted: ctx.msg })
})

export const nsfwMenu = wrap('nsfwmenu', ['menu18', 'adultmenu'], async ctx => {
  requireAdultEnabled(ctx)
  const body = [
    '✦════ < 🔞 MENÚ NSFW > ════⚝',
    '',
    'Solo para adultos. El sistema bloquea solicitudes relacionadas con menores, abuso, contenido no consentido, cámaras ocultas, explotación y animales.',
    '',
    '🔎 *BÚSQUEDA Y DESCARGA*',
    '.pornhubsearch <búsqueda>',
    '.xnxxsearch <búsqueda>',
    '.xvideossearch <búsqueda>',
    '.xvideosdl <url>',
    '.xnxxdl <url>',
    '.rule34img <etiqueta>',
    '.rule34video <etiqueta>',
    '.danbooru18 <etiqueta>',
    '',
    '🎲 *ALEATORIOS*',
    '.rnd18 list',
    `.rnd18 <${randomTypes.join('|')}>`,
    '.hentaivideo',
    '.straight',
    '',
    '🎭 *INTERACCIONES*',
    interactionTypes.map(type => `.${type}`).join(' • '),
    '',
    'Un administrador puede desactivar esta sección con .nsfwactivar off.'
  ].join('\n')
  await ctx.sock.sendMessage(ctx.chat, { text: body }, { quoted: ctx.msg })
})

function selectableAdultResults(data) {
  return searchResults(data)
    .filter(item => {
      const title = cleanText(item?.title, '')
      const url = String(item?.url || '').trim()
      return /^https?:\/\//i.test(url) && !blockedTerms.some(pattern => pattern.test(title))
    })
    .slice(0, 10)
}

async function sendAdultSelection(ctx, { query, provider, cacheKey, pickCommand, results }) {
  if (!results.length) throw new Error('La API no encontró resultados permitidos para esa búsqueda.')
  const token = saveSelection(cacheKey, results)
  const rows = results.map((item, index) => {
    const details = [
      item.duration ? cleanText(item.duration) : '',
      item.resolution ? cleanText(item.resolution).replace(/(\d+p)\1/i, '$1') : '',
      item.views !== undefined && item.views !== null ? `${formatNumber(item.views)} vistas` : ''
    ].filter(Boolean).join(' • ')
    return {
      header: `Resultado ${index + 1}`,
      title: cleanText(item.title, 'Sin título').slice(0, 90),
      description: (details || 'Seleccionar y descargar').slice(0, 100),
      id: `${config.prefix}${pickCommand} ${token} ${index}`
    }
  })
  const first = results[0]
  const preview = first?.thumbnail || first?.thumb || first?.image || first?.preview
  await sendInteractive(ctx.sock, ctx.chat, {
    title: `${provider} Downloader`,
    body: `Resultados para: *${query}*\nSelecciona un video y Nero lo descargará automáticamente.`,
    media: preview ? { image: { url: preview } } : null,
    buttons: [singleSelect('Ver resultados', [{ title: provider, rows }])]
  }, ctx.msg)
}

export const pornhubSearch = wrap('pornhubsearch', ['phsearch', 'ph'], async ctx => {
  requireAdultEnabled(ctx)
  const query = assertAllowedInput(ctx.args.join(' '))
  const data = await evoGet('/nsfw/search/pornhub', { query })
  await ctx.sock.sendMessage(ctx.chat, { text: formatSearchResults('Resultados de Pornhub', searchResults(data)) }, { quoted: ctx.msg })
})

export const xnxxSearch = wrap('xnxxsearch', ['xnsearch'], async ctx => {
  requireAdultEnabled(ctx)
  const query = assertAllowedInput(ctx.args.join(' '))
  const data = await evoGet('/nsfw/search/xnxx', { query })
  await sendAdultSelection(ctx, {
    query,
    provider: 'XNXX',
    cacheKey: 'nsfw-xnxx',
    pickCommand: 'xnxxpick',
    results: selectableAdultResults(data)
  })
})

export const xvideosSearch = wrap('xvideossearch', ['xvsearch'], async ctx => {
  requireAdultEnabled(ctx)
  const query = assertAllowedInput(ctx.args.join(' '))
  const data = await evoGet('/nsfw/search/xvideos', { query })
  await sendAdultSelection(ctx, {
    query,
    provider: 'XVideos',
    cacheKey: 'nsfw-xvideos',
    pickCommand: 'xvideospick',
    results: selectableAdultResults(data)
  })
})

export const xnxxPick = wrap('xnxxpick', [], async ctx => {
  requireAdultEnabled(ctx)
  const list = getSelection(ctx.args[0], 'nsfw-xnxx')
  const item = list?.[Number(ctx.args[1])]
  if (!item?.url) throw new Error('La selección venció. Ejecuta .xnxxsearch nuevamente.')
  await xnxxDownload.execute({ ...ctx, args: [item.url] })
})

export const xvideosPick = wrap('xvideospick', [], async ctx => {
  requireAdultEnabled(ctx)
  const list = getSelection(ctx.args[0], 'nsfw-xvideos')
  const item = list?.[Number(ctx.args[1])]
  if (!item?.url) throw new Error('La selección venció. Ejecuta .xvideossearch nuevamente.')
  await xvideosDownload.execute({ ...ctx, args: [item.url] })
})

function validateVideoPageUrl(value, allowedHosts) {
  let url
  try { url = new URL(String(value || '').trim()) } catch { throw new Error('Debes indicar una URL válida.') }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!allowedHosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`))) {
    throw new Error(`La URL debe pertenecer a ${allowedHosts.join(' o ')}.`)
  }
  return url.toString()
}

export const xvideosDownload = wrap('xvideosdl', ['xvdl'], async ctx => {
  requireAdultEnabled(ctx)
  const source = validateVideoPageUrl(ctx.args[0], ['xvideos.com'])
  const data = await evoGet('/nsfw/dl/xvideos', { url: source }, { timeoutMs: 180_000 })
  const result = data?.resultado?.result || data?.result || {}
  const url = extractMediaUrl(result)
  const caption = [
    '🔞 *XVideos*',
    `Título: ${cleanText(result.title, 'Sin título')}`,
    result.duration ? `Duración: ${cleanText(result.duration)}` : '',
    result.views !== undefined ? `Vistas: ${formatNumber(result.views)}` : '',
    result.likes !== undefined ? `Me gusta: ${formatNumber(result.likes)}` : ''
  ].filter(Boolean).join('\n')
  await sendMedia(ctx, url, 'video', caption)
})

export const xnxxDownload = wrap('xnxxdl', ['xndl'], async ctx => {
  requireAdultEnabled(ctx)
  const source = validateVideoPageUrl(ctx.args[0], ['xnxx.com'])
  const data = await evoGet('/nsfw/dl/xnxx', { url: source }, { timeoutMs: 180_000 })
  const result = data?.resultado?.result || data?.result || {}
  const url = result?.download?.high || result?.download?.low || extractMediaUrl(result)
  const caption = [
    '🔞 *XNXX*',
    `Título: ${cleanText(result.title, 'Sin título')}`,
    result.quality && result.quality !== '-' ? `Calidad: ${cleanText(result.quality)}` : ''
  ].filter(Boolean).join('\n')
  await sendMedia(ctx, url, 'video', caption)
})

export const rule34Image = wrap('rule34img', ['r34img'], async ctx => {
  requireAdultEnabled(ctx)
  const tag = assertAllowedInput(ctx.args.join(' '), 'etiqueta')
  const data = await evoGet('/nsfw/rule34', { tag, type: 'image' })
  await sendMedia(ctx, extractMediaUrl(data), 'image', `🔞 Rule34 • ${tag}`)
})

export const rule34Video = wrap('rule34video', ['r34video'], async ctx => {
  requireAdultEnabled(ctx)
  const tag = assertAllowedInput(ctx.args.join(' '), 'etiqueta')
  const data = await evoGet('/nsfw/rule34', { tag, type: 'video' })
  await sendMedia(ctx, extractMediaUrl(data), 'video', `🔞 Rule34 • ${tag}`)
})

export const danbooruAdult = wrap('danbooru18', ['danboorunsfw'], async ctx => {
  requireAdultEnabled(ctx)
  const keyword = assertAllowedInput(ctx.args.join(' '), 'etiqueta')
  const data = await evoGet('/nsfw/danbooru', { keyword })
  const url = extractMediaUrl(data)
  if (!url) throw new Error('Danbooru no devolvió resultados para esa etiqueta.')
  await sendMedia(ctx, url, /\.(mp4|webm)(\?|$)/i.test(url) ? 'video' : 'image', `🔞 Danbooru • ${keyword}`)
})

export const randomAdult = wrap('rnd18', ['random18'], async ctx => {
  requireAdultEnabled(ctx)
  const type = String(ctx.args[0] || 'list').toLowerCase()
  if (type === 'list') {
    await ctx.sock.sendMessage(ctx.chat, { text: `🔞 *Categorías aleatorias disponibles*\n\n${randomTypes.map(item => `• ${item}`).join('\n')}\n\nUso: .rnd18 <categoría>` }, { quoted: ctx.msg })
    return
  }
  if (!randomTypes.includes(type)) throw new Error(`Categoría no válida. Usa .rnd18 list.`)
  const data = await evoGet('/nsfw/rnd', { type })
  const url = extractMediaUrl(data)
  const kind = /\.(mp4|webm|mov)(\?|$)/i.test(url) ? 'video' : 'image'
  await sendMedia(ctx, url, kind, `🔞 Aleatorio • ${type}`)
})

export const hentaiVideo = wrap('hentaivideo', ['hentaivid'], async ctx => {
  requireAdultEnabled(ctx)
  const data = await evoGet('/nsfw/video/hentai')
  await sendMedia(ctx, extractMediaUrl(data), 'video', '🔞 Video animado para adultos')
})

export const straightVideo = wrap('straight', ['straightvideo'], async ctx => {
  requireAdultEnabled(ctx)
  const data = await evoGet('/porn/video/straight')
  await sendMedia(ctx, extractMediaUrl(data), 'video', '🔞 Video para adultos')
})

function contextInfo(msg) {
  const message = msg?.message || {}
  return message.extendedTextMessage?.contextInfo || message.imageMessage?.contextInfo || message.videoMessage?.contextInfo || {}
}

function makeInteraction(type) {
  return wrap(type, [], async ctx => {
    requireAdultEnabled(ctx)
    const data = await evoGet('/nsfw/interaction', { type })
    const target = contextInfo(ctx.msg)?.mentionedJid?.[0] || contextInfo(ctx.msg)?.participant || ''
    const actorText = `@${jidToken(ctx.sender)}`
    const caption = target
      ? `🔞 ${actorText} usó *${type}* con @${jidToken(target)}.\n${cleanText(data?.description, '')}`
      : `🔞 Interacción *${type}* solicitada por ${actorText}.\n${cleanText(data?.description, '')}`
    const mentions = target ? [ctx.sender, target] : [ctx.sender]
    const { buffer } = await fetchMedia(extractMediaUrl(data))
    await ctx.sock.sendMessage(ctx.chat, { video: buffer, gifPlayback: true, mimetype: 'video/mp4', caption, mentions }, { quoted: ctx.msg })
  })
}

export const nsfwCommands = [
  nsfwToggle,
  nsfwMenu,
  pornhubSearch,
  xnxxSearch,
  xvideosSearch,
  xnxxPick,
  xvideosPick,
  xvideosDownload,
  xnxxDownload,
  rule34Image,
  rule34Video,
  danbooruAdult,
  randomAdult,
  hentaiVideo,
  straightVideo,
  ...interactionTypes.map(makeInteraction)
]
