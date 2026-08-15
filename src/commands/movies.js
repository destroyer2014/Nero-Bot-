import config from '../../config.js'
import { apiGet } from '../lib/api.js'
import {
  sendInteractive,
  singleSelect
} from '../lib/interactive.js'
import { pickDownloadUrl } from '../lib/media.js'
import { runDownloadJob } from '../lib/downloadQueue.js'
import { sendLargeVideoAsDocuments } from '../lib/largeMedia.js'
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
const MOVIE_LIMIT = 10

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

function mediafirePageFrom(data) {
  const seen = new Set()
  const queue = [data]

  while (queue.length) {
    const current = queue.shift()

    if (typeof current === 'string') {
      if (/^https?:\/\/[^/]*mediafire\.com\//i.test(current)) {
        return current
      }
      continue
    }

    if (
      !current ||
      typeof current !== 'object' ||
      seen.has(current)
    ) continue

    seen.add(current)

    if (Array.isArray(current)) {
      queue.push(...current)
    } else {
      queue.push(...Object.values(current))
    }
  }

  return ''
}

async function resolveMovieDownload(slug) {
  const first = await apiGet(
    '/peliculas/mediafire',
    { slug },
    { timeoutMs: 240000 }
  )

  let direct = pickDownloadUrl(first)
  const mediafirePage =
    mediafirePageFrom(first) ||
    (
      direct && /mediafire\.com/i.test(direct)
        ? direct
        : ''
    )

  if (mediafirePage) {
    const resolved = await apiGet(
      '/mediafire',
      {
        mode: 'link',
        url: mediafirePage
      },
      { timeoutMs: 240000 }
    )

    direct = pickDownloadUrl(resolved)

    if (!direct) {
      throw new Error(
        'No encontré un archivo descargable para esa película.'
      )
    }

    return {
      url: direct,
      metadata: resolved
    }
  }

  if (!direct) {
    throw new Error(
      'No encontré un archivo descargable para esa película.'
    )
  }

  return {
    url: direct,
    metadata: first
  }
}

function accessLabel(ctx) {
  if (ctx.isOwner) return '👑 Owner • películas ilimitadas'
  if (isPremium(ctx.sender)) return '💎 Premium • películas ilimitadas'
  return '🆓 Free • 1 película cada 72 horas'
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
    id: `${prefix}menu peliculas`
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
      throw new Error(usage(ctx, 'pelicula <nombre>'))
    }

    const data = await apiGet(
      '/movies',
      {
        q: query,
        limit: MOVIE_LIMIT
      },
      { timeoutMs: 120000 }
    )

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
        'Solo puedes descargar 1 película cada 72 horas.\n' +
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
              quoted: ctx.msg
            }
          )
        }
      )

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
        : '🎬 Películas: *1 cada 72 horas*'
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
              'Ahora tendrá el límite Free de 1 película cada 72 horas.',
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
  peliculaPickCommand,
  premiumStatusCommand,
  addPremiumCommand,
  delPremiumCommand,
  premiumListCommand
]
