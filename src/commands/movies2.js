import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { sendInteractive, singleSelect } from '../lib/interactive.js'
import { getNeroTempRoot, ensureDiskSpace } from '../lib/diskGuard.js'
import { sendLargeVideoFileAsDocuments, sendLargeVideoAsDocuments } from '../lib/largeMedia.js'

const CREDIT = 'Nero AI™ | ©ArcadiaCorps'
const LIMIT = 8
const SOURCES = {
  pelisplus: process.env.PELISPLUSHD_API_BASE_URL || 'https://pelisplushd.tvymas.workers.dev',
  lamovie: process.env.LAMOVIE_API_BASE_URL || 'https://lamoviebot.tvymas.workers.dev',
  rescue: process.env.RESCUE_API_BASE_URL || 'https://rescue.tvymas.workers.dev'
}

function clean(v = '') {
  return String(v || '').trim()
}
function titleFromSlug(slug = '') {
  return decodeURIComponent(String(slug).replace(/[-_]+/g, ' ')).replace(/\b\w/g, c => c.toUpperCase()).trim() || 'Película'
}
function base(source) { return SOURCES[source] || SOURCES.pelisplus }

async function get(source, endpoint, params = {}, timeoutMs = 120000) {
  const url = new URL(endpoint, base(source) + '/')
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { accept: 'application/json,*/*;q=0.8', 'user-agent': 'Nero-Bot/1.0' } })
    const raw = await r.text()
    let data
    try { data = JSON.parse(raw) } catch { data = raw }
    if (!r.ok) throw new Error(`API ${source} respondió HTTP ${r.status}.`)
    return data
  } finally { clearTimeout(timer) }
}

function arrays(obj) {
  const out = []
  const walk = value => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { for (const x of value) walk(x); return }
    for (const [k, v] of Object.entries(value)) {
      if (Array.isArray(v) && /results|items|peliculas|movies|data|list|series/i.test(k)) out.push(...v.filter(x => x && typeof x === 'object'))
      walk(v)
    }
  }
  walk(obj)
  return out
}

function normalizeResults(data) {
  const raw = Array.isArray(data) ? data : [
    ...(Array.isArray(data?.results) ? data.results : []),
    ...(Array.isArray(data?.items) ? data.items : []),
    ...(Array.isArray(data?.data) ? data.data : []),
    ...arrays(data)
  ]
  const seen = new Set()
  return raw.map(x => {
    const slug = clean(x.slug || x.slug_id || x.id || x.url_slug || x.path || '')
    const title = clean(x.title || x.name || x.nombre || x.movie_title || x.titulo || (slug ? titleFromSlug(slug) : ''))
    return { ...x, slug, title, year: x.year || x.release_year || x.año, poster: x.poster || x.image || x.poster_path || x.cover || x.thumbnail }
  }).filter(x => x.slug && x.title && !seen.has(`${x.slug}|${x.title}`) && seen.add(`${x.slug}|${x.title}`)).slice(0, LIMIT)
}

function collectUrls(value, out = []) {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) out.push(value)
    return out
  }
  if (Array.isArray(value)) { for (const x of value) collectUrls(x, out); return out }
  if (value && typeof value === 'object') for (const v of Object.values(value)) collectUrls(v, out)
  return out
}

function pickUrl(data, regex) {
  const urls = collectUrls(data)
  return urls.find(u => regex.test(u)) || ''
}

function pickEmbed(data) {
  const urls = collectUrls(data)
  return urls.find(u => /embed|player|watch|stream/i.test(u) && !/image|poster|logo/i.test(u)) || ''
}

function pickM3u8(data) {
  const urls = collectUrls(data)
  return urls.find(u => /\.m3u8(?:\?|$)/i.test(u)) || ''
}

async function search(source, query) {
  const data = await get(source, '/search', { q: query, page: 1 })
  return { source, results: normalizeResults(data), raw: data }
}

async function searchAll(query) {
  const sources = ['pelisplus', 'lamovie']
  const responses = await Promise.allSettled(sources.map(s => search(s, query)))
  const results = []
  for (const r of responses) if (r.status === 'fulfilled') results.push(...r.value.results.map(x => ({ ...x, source: r.value.source })))
  const seen = new Set()
  return results.filter(x => {
    const key = `${x.source}|${x.slug}`
    if (seen.has(key)) return false
    seen.add(key); return true
  }).slice(0, LIMIT)
}

async function resolveStream(source, item) {
  let detail = null
  const endpoints = source === 'pelisplus'
    ? [`/pelicula/${encodeURIComponent(item.slug)}`, `/pelicula/${encodeURIComponent(item.slug)}`]
    : [`/pelicula/${encodeURIComponent(item.slug)}`]

  for (const ep of endpoints) {
    try { detail = await get(source, ep, {}, 180000); break } catch {}
  }

  const directMp4 = pickUrl(detail, /\.(mp4|mkv|webm)(?:\?|$)/i)
  if (directMp4) return { kind: 'direct', url: directMp4, detail }

  let m3u8 = pickM3u8(detail)
  let embed = pickEmbed(detail)

  if (!m3u8 && embed) {
    try {
      const stream = await get(source, '/streamurl', { embed_url: embed }, 180000)
      m3u8 = pickM3u8(stream) || pickUrl(stream, /stream|playlist|m3u/i)
      if (!m3u8) embed = pickEmbed(stream) || embed
    } catch {}
  }

  // Fallback: Rescue puede resolver embeds provenientes de PelisPlus/LaMovie.
  // La versión anterior solo intentaba Rescue cuando la fuente ya era "rescue",
  // por lo que un resultado de PelisPlus con embed terminaba en "no encontré stream".
  if (!m3u8 && embed) {
    const rescueAttempts = [
      ['/embedstream', { url: embed, format: 'json' }],
      ['/streamurl', { embed_url: embed }],
      ['/streamurl', { url: embed }]
    ]

    for (const [endpoint, params] of rescueAttempts) {
      try {
        const stream = await get('rescue', endpoint, params, 180000)
        m3u8 = pickM3u8(stream) || pickUrl(stream, /stream|playlist|m3u/i)
        if (m3u8) break
        const rescuedEmbed = pickEmbed(stream)
        if (rescuedEmbed && rescuedEmbed !== embed) {
          try {
            const nested = await get('rescue', '/embedstream', { url: rescuedEmbed, format: 'json' }, 180000)
            m3u8 = pickM3u8(nested) || pickUrl(nested, /stream|playlist|m3u/i)
            if (m3u8) break
          } catch {}
        }
      } catch {}
    }
  }

  if (m3u8) return { kind: 'hls', url: m3u8, detail, embed }
  throw new Error(`No encontré un stream reproducible para "${item.title}".`)
}

async function ffmpegToMp4(url, target) {
  await ensureDiskSpace(500 * 1024 * 1024, { label: 'convertir el stream a MP4' })
  await new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', url, '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', target]
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('La conversión a MP4 excedió el tiempo permitido.')) }, 30 * 60 * 1000)
    p.stderr.on('data', c => { err = (err + String(c)).slice(-4000) })
    p.on('error', e => { clearTimeout(timer); reject(new Error(`FFmpeg no está disponible: ${e.message}`)) })
    p.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`No pude convertir el stream a MP4. ${err}`)) })
  })
}

async function sendSearch(ctx, results, query) {
  if (!results.length) throw new Error(`No encontré "${query}" en las fuentes nuevas.`)
  const prefix = '.'
  const rows = results.map((item, i) => ({
    header: `${item.source === 'lamovie' ? 'LAMOVIE' : 'PELISPLUS'} • ${i + 1}`,
    title: `🎬 ${item.title}`.slice(0, 90),
    description: [item.year ? String(item.year) : '', 'Descarga MP4'].filter(Boolean).join(' • '),
    id: `${prefix}pelicula2pick ${item.source} ${encodeURIComponent(item.slug)}`
  }))
  await sendInteractive(ctx.sock, ctx.chat, {
    title: '🎬 NERO • PELÍCULA 2',
    body: [`Resultados para: *${query}*`, '', 'Selecciona una película para obtener el video.', '', `> ${CREDIT}`].join('\n'),
    footer: CREDIT,
    buttons: [singleSelect('🍿 Elegir película', [{ title: 'Resultados', rows }])]
  }, ctx.msg)
}

export const pelicula2Command = {
  name: 'pelicula2',
  aliases: ['pelicula-new', 'movie2'],
  description: 'Busca películas usando PelisPlusHD y LaMovie.',
  async execute(ctx) {
    const query = clean(ctx.args?.join(' '))
    if (!query) throw new Error('Uso: *.pelicula2 nombre de la película*')
    const results = await searchAll(query)
    await sendSearch(ctx, results, query)
  }
}

export const pelicula2PickCommand = {
  name: 'pelicula2pick',
  aliases: ['movie2pick'],
  description: 'Obtiene el stream y lo envía como MP4.',
  async execute(ctx) {
    const source = clean(ctx.args?.[0]).toLowerCase()
    const slug = clean(ctx.args?.slice(1).join(' '))
    if (!SOURCES[source] || !slug) throw new Error('Selección inválida. Usa *.pelicula2 <nombre>*.')
    const title = titleFromSlug(slug)
    const dir = await fs.mkdtemp(path.join(await getNeroTempRoot(), `nero-pelicula2-${randomUUID().slice(0, 8)}-`))
    const target = path.join(dir, `${title.replace(/[^\w\s-]/g, '').trim() || 'pelicula'}.mp4`)
    try {
      await ctx.sock.sendMessage(ctx.chat, { text: `⏳ *Preparando película*\n\n🎬 ${title}\n🔎 Fuente: ${source}\n\n> ${CREDIT}` }, { quoted: ctx.msg })
      const resolved = await resolveStream(source, { slug: decodeURIComponent(slug), title })
      if (resolved.kind === 'direct') {
        await sendLargeVideoAsDocuments(ctx.sock, ctx.chat, {
          url: resolved.url,
          title,
          filename: `${title}.mp4`,
          caption: `🎬 *${title}*\n\n> ${CREDIT}`,
          quoted: ctx.msg,
          singleDocumentMaxBytes: 1900 * 1024 * 1024,
          splitPartBytes: 700 * 1024 * 1024,
          silent: true,
          maxSourceBytes: 4096 * 1024 * 1024
        })
      } else {
        await ffmpegToMp4(resolved.url, target)
        await sendLargeVideoFileAsDocuments(ctx.sock, ctx.chat, {
          file: target,
          title,
          filename: `${title}.mp4`,
          caption: `🎬 *${title}*\n\n> ${CREDIT}`,
          quoted: ctx.msg,
          singleDocumentMaxBytes: 1900 * 1024 * 1024,
          splitPartBytes: 700 * 1024 * 1024,
          silent: true
        })
      }
      await ctx.sock.sendMessage(ctx.chat, { text: `✅ *Película enviada*\n🎬 ${title}` }, { quoted: ctx.msg }).catch(() => {})
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

export const movie2Commands = [pelicula2Command, pelicula2PickCommand]
