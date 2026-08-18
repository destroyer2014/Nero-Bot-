import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import config from '../../config.js'
import { apiGet } from '../lib/api.js'
import {
  sendInteractive,
  singleSelect
} from '../lib/interactive.js'
import { pickDownloadUrl } from '../lib/media.js'
import { runDownloadJob } from '../lib/downloadQueue.js'
import {
  downloadLargeMediaSource,
  sendLargeVideoAsDocuments,
  sendLargeVideoFileAsDocuments
} from '../lib/largeMedia.js'
import {
  acquireMovieLock,
  addPremium,
  formatMovieWait,
  getMovieAccess,
  isPremium,
  listPremium,
  markMovieSuccess,
  premiumIdentity,
  releaseMovieLock,
  removePremium
} from '../lib/premiumStore.js'

const NERO_CREDIT = 'Nero AI™ | ©ArcadiaCorps'
const require = createRequire(import.meta.url)
let BUNDLED_7ZIP = ''
try {
  BUNDLED_7ZIP = require('7zip-bin-full')?.path7z || ''
} catch {}
const MOVIE_LIMIT = 10

const MOVIE_SINGLE_DOCUMENT_BYTES = Math.max(
  100,
  Number(process.env.MOVIE_SINGLE_DOCUMENT_MB || 1900)
) * 1024 * 1024

const MOVIE_SPLIT_PART_BYTES = Math.max(
  100,
  Number(process.env.MOVIE_SPLIT_PART_MB || 700)
) * 1024 * 1024

const MOVIE_TRANSIENT_STATUSES = new Set([
  429, 500, 502, 503, 504
])

const movieWait = ms =>
  new Promise(resolve => setTimeout(resolve, ms))

async function movieApiGet(endpoint, params = {}, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 3))
  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await apiGet(
        endpoint,
        params,
        { timeoutMs: options.timeoutMs || 180000 }
      )
    } catch (error) {
      lastError = error
      const status = Number(error?.status || 0)

      if (
        !MOVIE_TRANSIENT_STATUSES.has(status) ||
        attempt >= attempts
      ) {
        throw error
      }

      await movieWait(Math.min(7000, 1200 * attempt * attempt))
    }
  }

  throw lastError || new Error(
    'El servidor de películas no respondió.'
  )
}

async function movieSearchData(query) {
  try {
    return await movieApiGet(
      '/movies',
      {
        q: query,
        limit: MOVIE_LIMIT
      },
      {
        timeoutMs: 120000,
        attempts: 3
      }
    )
  } catch (error) {
    if (Number(error?.status || 0) === 404) {
      return { results: [] }
    }
    throw error
  }
}

const MOVIE_CATALOGS = {
  estrenos: {
    title: '🎞️ Películas Estreno',
    description: 'Películas recientes y estrenos.',
    query: '2026'
  },
  accion: {
    title: '💥 Acción y Aventura',
    description: 'Acción, aventura y adrenalina.',
    query: 'accion'
  },
  terror: {
    title: '👻 Terror y Suspenso',
    description: 'Terror, suspenso y misterio.',
    query: 'terror'
  },
  drama: {
    title: '🎭 Drama',
    description: 'Historias dramáticas y emocionales.',
    query: 'drama'
  },
  comedia: {
    title: '🤣 Comedia',
    description: 'Películas para reír.',
    query: 'comedia'
  },
  romance: {
    title: '💘 Romance',
    description: 'Romance y historias de amor.',
    query: 'romance'
  },
  sorpresa: {
    title: '🎲 Sorpréndeme',
    description: 'Una búsqueda aleatoria del catálogo.',
    queries: [
      'dragon ball',
      'marvel',
      'terror',
      'comedia',
      'romance',
      'accion',
      'aventura',
      '2026'
    ]
  }
}

function movieCatalogQuery(category) {
  if (category.query) return category.query
  const list = category.queries || []
  return list[Math.floor(Math.random() * list.length)] || '2026'
}

async function sendMovieCatalog(ctx) {
  const prefix = prefixOf(ctx)

  const rows = Object.entries(MOVIE_CATALOGS).map(([key, item]) => ({
    header: 'Catálogo',
    title: item.title,
    description: item.description,
    id: `${prefix}peliculacatalog ${key}`
  }))

  rows.splice(1, 0, {
    header: 'Streaming',
    title: '📡 Animes en Estreno',
    description: 'Lo mejor del anime actual',
    id: `${prefix}animeairing`
  })

  await sendInteractive(
    ctx.sock,
    ctx.chat,
    {
      title: '🍿 NERO • CATÁLOGO DE PELÍCULAS',
      body: [
        '🎬 *Tu cine en WhatsApp*',
        '',
        'Toca el botón para explorar el catálogo.',
        '',
        'También puedes buscar directamente:',
        `*${prefix}pelicula spiderman*`,
        '',
        `💳 ${accessLabel(ctx)}`
      ].join('\n'),
      footer: NERO_CREDIT,
      buttons: [
        singleSelect(
          '🍿 Abrir Catálogo',
          [{
            title: '🎬 Categorías',
            rows
          }]
        )
      ]
    },
    ctx.msg
  )
}

export const peliculaCatalogCommand = {
  name: 'peliculacatalog',
  aliases: ['moviecatalog'],
  description: 'Abre una categoría del catálogo de películas.',

  async execute(ctx) {
    const key = String(ctx.args?.[0] || '').trim().toLowerCase()
    const category = MOVIE_CATALOGS[key]

    if (!category) {
      await sendMovieCatalog(ctx)
      return
    }

    const query = movieCatalogQuery(category)
    const data = await movieSearchData(query)

    await sendMovieSearch(ctx, category.title, data)
  }
}


function prefixOf(ctx) {
  return ctx?.prefix ||
    ctx?.subbotConfig?.prefix ||
    config.prefix ||
    '.'
}

function usage(ctx, value) {
  return `Uso: *${prefixOf(ctx)}${value}*`
}

function contextInfo(msg) {
  return msg?.message?.extendedTextMessage?.contextInfo ||
    msg?.message?.imageMessage?.contextInfo ||
    msg?.message?.videoMessage?.contextInfo ||
    msg?.message?.documentMessage?.contextInfo ||
    null
}

function targetPremiumNumber(ctx) {
  const info = contextInfo(ctx.msg)
  const mention = info?.mentionedJid?.[0]
  const quoted = info?.participant
  const argument = ctx.args?.[0]

  return premiumIdentity(mention || quoted || argument || '')
}

function cleanSlug(value = '') {
  let decoded = String(value || '').trim()
  try {
    decoded = decodeURIComponent(decoded)
  } catch {}

  return decoded
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 180)
}

function titleFromSlug(slug = '') {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map(word => {
      if (/^\d{4}$/.test(word)) return word
      if (['z', 'gt', 'kai', 'ii', 'iii', 'iv'].includes(word)) {
        return word.toUpperCase()
      }
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(' ')
}

function validYear(value) {
  const year = Number(value)
  return Number.isInteger(year) && year >= 1888 && year <= 2100
    ? year
    : null
}

function movieSources(data = {}) {
  const movie = data.movie || data.result || data
  return [
    ...(Array.isArray(movie?.mediafire) ? movie.mediafire : []),
    ...(Array.isArray(data?.mediafire) ? data.mediafire : [])
  ].filter(Boolean)
}

function sourceFileName(source = {}) {
  return String(
    source.file_name ||
    source.filename ||
    source.name ||
    ''
  ).trim()
}

function sourceFormat(source = {}) {
  const explicit = String(source.format || '').trim().toLowerCase()
  if (explicit) return explicit
  return path.extname(sourceFileName(source)).replace(/^\./, '').toLowerCase()
}

function isArchiveSource(source = {}) {
  const format = sourceFormat(source)
  return (
    ['rar', 'zip', '7z'].includes(format) ||
    /\.(rar|zip|7z)$/i.test(sourceFileName(source))
  )
}

function safeLocalName(value = 'movie-source') {
  return String(value || 'movie-source')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150) || 'movie-source'
}

async function runArchiveTool(command, args, timeoutMs = 30 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let output = ''
    let settled = false

    const fail = error => {
      if (settled) return
      settled = true
      reject(error)
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error('La extracción de la película tardó demasiado.'))
    }, timeoutMs)

    const capture = chunk => {
      output = (output + String(chunk)).slice(-20000)
    }

    child.stdout.on('data', capture)
    child.stderr.on('data', capture)

    child.on('error', error => {
      clearTimeout(timer)
      fail(error)
    })

    child.on('close', code => {
      clearTimeout(timer)
      if (settled) return
      settled = true

      if (code === 0) {
        resolve(output)
        return
      }

      const error = new Error(
        `${command} terminó con código ${code}: ${output.slice(-1500)}`
      )
      error.toolOutput = output
      reject(error)
    })
  })
}

async function extractMovieArchive(archiveFile, targetDir, password = '') {
  await fs.mkdir(targetDir, { recursive: true })

  const passwordArg = password ? `-p${password}` : null
  if (BUNDLED_7ZIP) {
    await fs.chmod(BUNDLED_7ZIP, 0o755).catch(() => {})
  }

  const tools = [
    BUNDLED_7ZIP,
    '7zz',
    '7z'
  ].filter(Boolean)
  let missing = 0
  let lastError = null

  for (const command of tools) {
    const args = [
      'x',
      '-y',
      `-o${targetDir}`,
      ...(passwordArg ? [passwordArg] : []),
      archiveFile
    ]

    try {
      await runArchiveTool(command, args)
      return
    } catch (error) {
      if (error?.code === 'ENOENT') {
        missing += 1
        continue
      }
      lastError = error
      break
    }
  }

  if (missing === tools.length) {
    throw new Error(
      'Nero no encontró un ejecutable 7-Zip disponible para extraer esta película.'
    )
  }

  const detail = String(lastError?.toolOutput || lastError?.message || '')

  if (/wrong password|password is incorrect|encrypted/i.test(detail)) {
    throw new Error(
      'No pude extraer el archivo de la película porque la contraseña es incorrecta o no fue proporcionada.'
    )
  }

  throw new Error(
    'No pude extraer el archivo RAR de la película. La fuente puede estar incompleta o dañada.'
  )
}

async function walkFiles(dir) {
  const result = []
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...await walkFiles(file))
    } else if (entry.isFile()) {
      result.push(file)
    }
  }

  return result
}

async function findExtractedVideo(dir) {
  const allowed = new Set([
    '.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v'
  ])

  const videos = []

  for (const file of await walkFiles(dir)) {
    if (!allowed.has(path.extname(file).toLowerCase())) continue

    try {
      const stat = await fs.stat(file)
      if (stat.size > 10 * 1024 * 1024) {
        videos.push({ file, size: stat.size })
      }
    } catch {}
  }

  videos.sort((a, b) => b.size - a.size)
  return videos[0] || null
}

async function resolveMovieDownload(slug) {
  let first

  try {
    first = await movieApiGet(
      '/peliculas/mediafire',
      { slug },
      { timeoutMs: 240000, attempts: 3 }
    )
  } catch (error) {
    const status = Number(error?.status || 0)

    if ([400, 404, 422].includes(status)) {
      throw new Error(
        `No encontré una fuente de descarga disponible para "${titleFromSlug(slug)}".`
      )
    }

    throw error
  }

  const sources = movieSources(first)
    .sort((a, b) =>
      Number(Boolean(b?.verified)) -
      Number(Boolean(a?.verified))
    )

  let lastError = null

  for (const source of sources.slice(0, 8)) {
    if (!source?.url) continue

    try {
      const resolved = /mediafire\.com/i.test(source.url)
        ? await movieApiGet(
            '/mediafire',
            { mode: 'link', url: source.url },
            { timeoutMs: 240000, attempts: 3 }
          )
        : source

      const direct = pickDownloadUrl(resolved)

      if (!direct) continue

      return {
        url: direct,
        metadata: resolved,
        source,
        archive: isArchiveSource(source),
        format: sourceFormat(source),
        fileName: sourceFileName(source),
        password: String(source.password || '')
      }
    } catch (error) {
      lastError = error
      console.warn(
        '[MOVIE] fuente descartada:',
        source?.url,
        error?.message || error
      )
    }
  }

  const direct = pickDownloadUrl(first)

  if (direct) {
    return {
      url: direct,
      metadata: first,
      source: {},
      archive: false,
      format: '',
      fileName: '',
      password: ''
    }
  }

  const status = Number(lastError?.status || 0)

  if (MOVIE_TRANSIENT_STATUSES.has(status)) {
    throw new Error(
      'El servidor de películas está temporalmente ocupado. Intenta nuevamente en unos minutos.'
    )
  }

  throw new Error(
    `No encontré un archivo descargable para "${titleFromSlug(slug)}". Prueba con otro resultado.`
  )
}

async function sendMovieArchive(ctx, resolved, title) {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), `nero-movie-${randomUUID().slice(0, 8)}-`)
  )

  const format =
    resolved.format ||
    path.extname(resolved.fileName).replace(/^\./, '') ||
    'rar'

  const archiveFile = path.join(
    dir,
    safeLocalName(resolved.fileName || `${title}.${format}`)
  )
  const extractDir = path.join(dir, 'extracted')

  try {
    await downloadLargeMediaSource(resolved.url, archiveFile)

    await extractMovieArchive(
      archiveFile,
      extractDir,
      resolved.password
    )

    const video = await findExtractedVideo(extractDir)

    if (!video) {
      throw new Error(
        'No encontré un video válido dentro del archivo de la película.'
      )
    }

    await sendLargeVideoFileAsDocuments(
      ctx.sock,
      ctx.chat,
      {
        file: video.file,
        title,
        filename: `${title}${path.extname(video.file) || '.mp4'}`,
        caption: [
          `🎬 *${title}*`,
          '',
          `> ${NERO_CREDIT}`
        ].join('\n'),
        quoted: ctx.msg,
        singleDocumentMaxBytes: MOVIE_SINGLE_DOCUMENT_BYTES,
        splitPartBytes: MOVIE_SPLIT_PART_BYTES,
        silent: true
      }
    )
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function accessLabel(ctx) {
  if (ctx.isOwner) return '👑 Owner • películas ilimitadas'
  if (isPremium(ctx.sender)) return '💎 Premium • películas ilimitadas'
  return '🆓 Free • 1 película cada 24 horas'
}

async function sendMovieSearch(ctx, query, data) {
  const list = (data.results || [])
    .filter(item => item?.slug)
    .slice(0, MOVIE_LIMIT)

  if (!list.length) {
    throw new Error(`No encontré películas para "${query}".`)
  }

  const prefix = prefixOf(ctx)

  const rows = list.map((item, index) => {
    const year = validYear(item.year)

    return {
      header: `Resultado ${index + 1}`,
      title: `🎬 ${item.title || titleFromSlug(item.slug)}`
        .slice(0, 90),
      description: [
        'Película',
        year ? String(year) : ''
      ].filter(Boolean).join(' • ').slice(0, 100),
      id:
        `${prefix}peliculapick ` +
        encodeURIComponent(item.slug)
    }
  })

  rows.push({
    header: 'Catálogo',
    title: '📋 Volver al menú de películas',
    description: 'Ver los comandos disponibles',
    id: `${prefix}pelicula`
  })

  const first = list[0]

  await sendInteractive(
    ctx.sock,
    ctx.chat,
    {
      title: '🔎 RESULTADOS • PELÍCULAS',
      body: [
        `Se encontraron *${list.length}* resultado${list.length === 1 ? '' : 's'}.`,
        '',
        '▶️ Toca el botón para elegir qué deseas ver.',
        `💳 ${accessLabel(ctx)}`,
        '',
        '> Selecciona una película para iniciar la descarga.'
      ].join('\n'),
      footer: NERO_CREDIT,
      media: first?.poster
        ? { image: { url: first.poster } }
        : null,
      buttons: [
        singleSelect(
          '👀 Ver Opciones',
          [{
            title: '🔎 Resultados',
            rows
          }]
        )
      ]
    },
    ctx.msg
  )
}

export const peliculaCommand = {
  name: 'pelicula',
  aliases: ['peliculas', 'movies', 'moviebuscar'],
  description: 'Busca películas y permite descargarlas.',

  async execute(ctx) {
    const query = String(ctx.args?.join(' ') || '').trim()

    if (!query) {
      await sendMovieCatalog(ctx)
      return
    }

    const data = await movieSearchData(query)

    await sendMovieSearch(ctx, query, data)
  }
}

export const peliculaPickCommand = {
  name: 'peliculapick',
  aliases: ['moviepick'],
  description: 'Descarga una película seleccionada.',

  async execute(ctx) {
    const slug = cleanSlug(ctx.args?.[0])

    if (!slug) {
      throw new Error(
        'La selección de película no es válida. Busca nuevamente con .pelicula.'
      )
    }

    const access = getMovieAccess(
      ctx.sender,
      { isOwner: ctx.isOwner }
    )

    if (!access.unlimited && access.remainingMs > 0) {
      throw new Error(
        'Solo puedes descargar 1 película cada 24 horas.\n' +
        `Espera: ${formatMovieWait(access.remainingMs)}`
      )
    }

    const limited = !access.unlimited
    let lockAcquired = false

    if (limited) {
      const lock = acquireMovieLock(ctx.sender)

      if (!lock.ok) {
        throw new Error(
          'Solo puedes tener una descarga de película en curso a la vez.'
        )
      }

      lockAcquired = true
    }

    const title = titleFromSlug(slug) || 'Película'

    try {
      await runDownloadJob(
        ctx,
        'heavy',
        '.pelicula',
        async () => {
          await ctx.sock.sendMessage(
            ctx.chat,
            {
              text: [
                '🎬 *Preparando película*',
                '',
                `Título: *${title}*`,
                'Estado: resolviendo archivo…',
                '',
                `> ${NERO_CREDIT}`
              ].join('\n')
            },
            { quoted: ctx.msg }
          ).catch(() => {})

          const resolved = await resolveMovieDownload(slug)

          if (resolved.archive) {
            await sendMovieArchive(ctx, resolved, title)
          } else {
            await sendLargeVideoAsDocuments(
              ctx.sock,
              ctx.chat,
              {
                url: resolved.url,
                title,
                filename: `${title}.mp4`,
                caption: [
                  `🎬 *${title}*`,
                  '',
                  `> ${NERO_CREDIT}`
                ].join('\n'),
                quoted: ctx.msg,
                singleDocumentMaxBytes: MOVIE_SINGLE_DOCUMENT_BYTES,
                splitPartBytes: MOVIE_SPLIT_PART_BYTES,
                silent: true
              }
            )
          }
        }
      )

      await ctx.sock.sendMessage(
        ctx.chat,
        {
          text: [
            '✅ *Película enviada*',
            `Título: *${title}*`,
            '',
            `> ${NERO_CREDIT}`
          ].join('\n')
        },
        { quoted: ctx.msg }
      ).catch(() => {})

      if (limited) {
        markMovieSuccess(
          ctx.sender,
          {
            title,
            slug
          }
        )
      }
    } finally {
      if (lockAcquired) {
        releaseMovieLock(ctx.sender)
      }
    }
  }
}

export const premiumStatusCommand = {
  name: 'premium',
  aliases: ['mipremium', 'plan'],
  description: 'Muestra tu plan y límite de películas.',

  async execute(ctx) {
    const access = getMovieAccess(
      ctx.sender,
      { isOwner: ctx.isOwner }
    )

    let plan
    if (ctx.isOwner) {
      plan = '👑 OWNER'
    } else if (access.unlimited) {
      plan = '💎 PREMIUM'
    } else if (ctx.isSubOwner) {
      plan = '⭐ SUBOWNER • límite Free'
    } else {
      plan = '🆓 FREE'
    }

    const lines = [
      '💎 *NERO PREMIUM*',
      '',
      `Plan: *${plan}*`,
      access.unlimited
        ? '🎬 Películas: *sin límites*'
        : '🎬 Películas: *1 cada 24 horas*'
    ]

    if (!access.unlimited) {
      lines.push(
        access.remainingMs > 0
          ? `⏳ Próxima disponible en: *${formatMovieWait(access.remainingMs)}*`
          : '✅ Puedes descargar una película ahora.'
      )
    }

    lines.push('', `> ${NERO_CREDIT}`)

    await ctx.sock.sendMessage(
      ctx.chat,
      { text: lines.join('\n') },
      { quoted: ctx.msg }
    )
  }
}

function assertOwner(ctx) {
  if (!ctx.isOwner) {
    throw new Error(
      'Solo el Owner puede administrar usuarios Premium.'
    )
  }
}

export const addPremiumCommand = {
  name: 'addpremium',
  aliases: ['darpremium', 'premiumadd'],
  description: 'Da Premium permanente a un usuario.',

  async execute(ctx) {
    assertOwner(ctx)

    const target = targetPremiumNumber(ctx)

    if (!target) {
      throw new Error(
        usage(ctx, 'addpremium <número o @usuario>')
      )
    }

    if ((config.ownerNumbers || []).includes(target)) {
      await ctx.sock.sendMessage(
        ctx.chat,
        {
          text:
            `👑 +${target} ya es Owner y tiene acceso ilimitado.`
        },
        { quoted: ctx.msg }
      )
      return
    }

    addPremium(
      target,
      { addedBy: ctx.sender }
    )

    await ctx.sock.sendMessage(
      ctx.chat,
      {
        text: [
          '✅ *Premium activado*',
          `Usuario: +${target}`,
          '🎬 Películas: sin límites',
          '⏳ Duración: hasta que el Owner lo quite.',
          '',
          `> ${NERO_CREDIT}`
        ].join('\n')
      },
      { quoted: ctx.msg }
    )
  }
}

export const delPremiumCommand = {
  name: 'delpremium',
  aliases: ['quitarpremium', 'premiumdel'],
  description: 'Quita Premium a un usuario.',

  async execute(ctx) {
    assertOwner(ctx)

    const target = targetPremiumNumber(ctx)

    if (!target) {
      throw new Error(
        usage(ctx, 'delpremium <número o @usuario>')
      )
    }

    const removed = removePremium(target)

    await ctx.sock.sendMessage(
      ctx.chat,
      {
        text: removed
          ? [
              '✅ *Premium eliminado*',
              `Usuario: +${target}`,
              'Ahora tendrá el límite Free de 1 película cada 24 horas.',
              '',
              `> ${NERO_CREDIT}`
            ].join('\n')
          : `ℹ️ +${target} no estaba registrado como Premium.`
      },
      { quoted: ctx.msg }
    )
  }
}

export const premiumListCommand = {
  name: 'premiumlist',
  aliases: ['listpremium', 'premiumusers'],
  description: 'Lista los usuarios Premium.',

  async execute(ctx) {
    assertOwner(ctx)

    const users = listPremium()

    const text = users.length
      ? [
          '💎 *USUARIOS PREMIUM*',
          '',
          ...users.map((user, index) => {
            const date = new Date(
              Number(user.addedAt || Date.now())
            ).toLocaleDateString(
              'es-PE',
              { timeZone: config.timezone }
            )

            return `${index + 1}. +${user.number} • desde ${date}`
          }),
          '',
          `Total: ${users.length}`,
          '',
          `> ${NERO_CREDIT}`
        ].join('\n')
      : [
          '💎 *USUARIOS PREMIUM*',
          '',
          'No hay usuarios Premium registrados.',
          '',
          `> ${NERO_CREDIT}`
        ].join('\n')

    await ctx.sock.sendMessage(
      ctx.chat,
      { text },
      { quoted: ctx.msg }
    )
  }
}

export const movieCommands = [
  peliculaCommand,
  peliculaCatalogCommand,
  peliculaPickCommand,
  premiumStatusCommand,
  addPremiumCommand,
  delPremiumCommand,
  premiumListCommand
]
