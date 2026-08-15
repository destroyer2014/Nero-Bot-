import config from '../../config.js'
import { apiGet, evoGet } from '../lib/api.js'
import { sendInteractive, singleSelect } from '../lib/interactive.js'
import { runDownloadJob } from '../lib/downloadQueue.js'
import { saveSelection, getSelection } from '../lib/selectionCache.js'
import { sendLargeVideoAsDocuments } from '../lib/largeMedia.js'

const NERO_CREDIT = 'Nero AI™ | ©ArcadiaCorps'
const ANIME_SEARCH_LIMIT = 10
const ANIME_AIRING_LIMIT = 7
const ANIME_WAIT = 30 * 60 * 1000
const ANIME_SINGLE_DOCUMENT_BYTES = Math.max(
  100,
  Number(process.env.ANIME_SINGLE_DOCUMENT_MB || 700)
) * 1024 * 1024
const ANIME_SPLIT_PART_BYTES = Math.max(
  100,
  Number(process.env.ANIME_SPLIT_PART_MB || 700)
) * 1024 * 1024

const animeCooldown = new Map()
const animeActive = new Set()

const decode = value => String(value || '')
  .replace(/&#(\d+);/g, (_, code) => {
    const n = Number(code)
    return Number.isFinite(n) ? String.fromCodePoint(n) : _
  })
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
    const n = Number.parseInt(code, 16)
    return Number.isFinite(n) ? String.fromCodePoint(n) : _
  })
  .replace(/&amp;/g, '&')
  .replace(/&apos;|&#0?39;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')

const cleanText = value => decode(value)
  .replace(/pr\?ximos/gi, 'próximos')
  .replace(/emisi\?n/gi, 'emisión')
  .replace(/epis\?dios/gi, 'episodios')
  .replace(/\s+/g, ' ')
  .trim()

const prefixOf = ctx =>
  ctx?.prefix || ctx?.subbotConfig?.prefix || config.prefix || '.'

const wrap = (name, aliases, description, fn) => ({
  name,
  aliases,
  description,
  async execute(ctx) {
    try {
      await fn(ctx)
    } catch (error) {
      console.error(`[ANIME:${name}]`, error?.message || error)
      await ctx.sock.sendMessage(
        ctx.chat,
        { text: `❌ ${error?.message || 'No se pudo completar la consulta de anime.'}` },
        { quoted: ctx.msg }
      ).catch(() => {})
    }
  }
})

function cleanSlug(value = '') {
  let decoded = String(value || '').trim()
  try { decoded = decodeURIComponent(decoded) } catch {}
  return decoded
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 180)
}

function decodeArg(value = '') {
  try { return decodeURIComponent(String(value || '')) } catch { return String(value || '') }
}

function chunks(rows, size = 10) {
  const result = []
  for (let i = 0; i < rows.length; i += size) {
    result.push(rows.slice(i, i + size))
  }
  return result
}

function rowSections(rows, title = 'Resultados') {
  return chunks(rows, 10).map((part, index) => ({
    title: rows.length > 10 ? `${title} ${index + 1}` : title,
    rows: part
  }))
}

async function animeApi(action, params = {}, options = {}) {
  return apiGet(
    '/anime',
    { action, ...params },
    { timeoutMs: options.timeoutMs || 180000 }
  )
}

function statusLabel(value = '') {
  const status = String(value || '').toLowerCase()
  if (status === 'finished') return 'Finalizado'
  if (status === 'current') return 'En emisión'
  if (status === 'tba') return 'Por anunciar'
  return cleanText(value) || 'Estado no disponible'
}

async function sendAnimeCatalog(ctx) {
  const prefix = prefixOf(ctx)
  const rows = [
    {
      header: 'Anime',
      title: '📡 Animes en Estreno',
      description: 'Animes y episodios en emisión',
      id: `${prefix}animeairing`
    },
    {
      header: 'Anime',
      title: '📰 Noticias',
      description: 'Noticias recientes de anime',
      id: `${prefix}animenews`
    },
    {
      header: 'Anime',
      title: '🔥 Tendencias',
      description: 'Animes en tendencia',
      id: `${prefix}animetrending`
    },
    {
      header: 'Anime',
      title: '📅 Próximos Estrenos',
      description: 'Calendario de próximos episodios',
      id: `${prefix}animeschedule`
    },
    {
      header: 'Anime',
      title: '🆕 Episodios Recientes',
      description: 'Contenido reciente de anime',
      id: `${prefix}animelatest`
    },
    {
      header: 'Buscar',
      title: '🔎 Buscar Anime',
      description: `Usa ${prefix}anime <nombre>`,
      id: `${prefix}animehelp`
    }
  ]

  await sendInteractive(
    ctx.sock,
    ctx.chat,
    {
      title: '🌸 NERO • CATÁLOGO ANIME',
      body: [
        '🌸 *Tu biblioteca de anime en WhatsApp*',
        '',
        '▶️ Toca el botón para explorar.',
        '▶️ O busca directamente:',
        `*${prefix}anime Shigatsu wa Kimi no Uso*`
      ].join('\n'),
      footer: NERO_CREDIT,
      buttons: [singleSelect('🌸 Abrir Catálogo', [{ title: '🌸 Anime', rows }])]
    },
    ctx.msg
  )
}

async function sendAnimeSearch(ctx, query) {
  const data = await animeApi('search', {
    q: query,
    limit: ANIME_SEARCH_LIMIT
  })

  const list = (data.results || [])
    .filter(item => item?.slug)
    .slice(0, ANIME_SEARCH_LIMIT)

  if (!list.length) {
    throw new Error(`No encontré el anime "${query}".`)
  }

  const prefix = prefixOf(ctx)
  const token = saveSelection('anime-search-v2', list)
  const rows = list.map((item, index) => ({
    header: `Resultado ${index + 1}`,
    title: `🌸 ${cleanText(item.title) || 'Anime'}`.slice(0, 90),
    description: 'Ver episodios disponibles',
    id: `${prefix}animepick ${token} ${index}`
  }))

  rows.push({
    header: 'Catálogo',
    title: '📋 Volver al Catálogo Anime',
    description: 'Ver todas las categorías',
    id: `${prefix}anime`
  })

  const first = list[0]

  await sendInteractive(
    ctx.sock,
    ctx.chat,
    {
      title: '🔎 RESULTADOS • ANIME',
      body: [
        `Se encontraron *${list.length}* resultado${list.length === 1 ? '' : 's'}.`,
        '',
        '▶️ Toca el botón para elegir qué deseas ver.'
      ].join('\n'),
      footer: NERO_CREDIT,
      media: first?.thumbnail ? { image: { url: first.thumbnail } } : null,
      buttons: [singleSelect('👀 Ver Opciones', rowSections(rows, '🌸 Resultados'))]
    },
    ctx.msg
  )
}

async function findCoverForTitle(title) {
  if (!title) return null
  try {
    const data = await animeApi('search', { q: title, limit: 1 })
    return data.results?.[0]?.thumbnail || null
  } catch {
    return null
  }
}

async function sendAnimeDiscovery(ctx, {
  action,
  title,
  icon = '🌸',
  body = '',
  limit = 10,
  includeBackToMovieCatalog = false
}) {
  const data = await animeApi(action, { limit })
  const list = (data.results || []).slice(0, limit)
  if (!list.length) throw new Error('No encontré resultados de anime en este momento.')

  const prefix = prefixOf(ctx)
  const rows = list.map((item, index) => {
    const animeTitle = cleanText(item.title) || `Anime ${index + 1}`
    const description = action === 'schedule'
      ? cleanText(item.episode) || 'Próximo episodio'
      : [
          item.score ? `⭐ ${item.score}` : '',
          item.status ? statusLabel(item.status) : ''
        ].filter(Boolean).join(' • ') || 'Ver anime'

    return {
      header: title.replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñ ]/g, '').trim().slice(0, 30) || 'Anime',
      title: `${icon} ${animeTitle}`.slice(0, 90),
      description: description.slice(0, 100),
      id: `${prefix}animequery ${encodeURIComponent(animeTitle)}`
    }
  })

  rows.push({
    header: 'Catálogo',
    title: includeBackToMovieCatalog
      ? '📋 Volver al Catálogo'
      : '📋 Volver al Catálogo Anime',
    description: 'Ver todas las categorías',
    id: includeBackToMovieCatalog
      ? `${prefix}pelicula`
      : `${prefix}anime`
  })

  const cover = await findCoverForTitle(cleanText(list[0]?.title))

  await sendInteractive(
    ctx.sock,
    ctx.chat,
    {
      title,
      body: body || [
        `Se encontraron *${list.length}* resultado${list.length === 1 ? '' : 's'}.`,
        '',
        '▶️ Toca el botón para elegir qué deseas ver.'
      ].join('\n'),
      footer: NERO_CREDIT,
      media: cover ? { image: { url: cover } } : null,
      buttons: [singleSelect('👀 Ver Opciones', rowSections(rows, title.slice(0, 30)))]
    },
    ctx.msg
  )
}

async function sendAnimeDetail(ctx, slug, selectedTitle = '') {
  let data
  try {
    // Petición mínima: coincide con el endpoint que devuelve el catálogo
    // correctamente en la documentación de DVYer.
    data = await animeApi('detail', { slug }, { timeoutMs: 240000 })
  } catch (error) {
    const status = Number(error?.status || 0)
    console.warn('[ANIME] detail falló', {
      slug,
      status,
      message: error?.message || String(error)
    })

    // Si DVYer rechaza el slug seleccionado, hacemos una sola
    // revalidación por título y usamos el slug exacto que vuelva a entregar.
    if (status === 422 && selectedTitle) {
      const retrySearch = await animeApi('search', {
        q: selectedTitle,
        limit: ANIME_SEARCH_LIMIT
      }, { timeoutMs: 180000 })

      const retry = (retrySearch.results || []).find(item =>
        String(item?.slug || '').trim() === String(slug || '').trim()
      ) || retrySearch.results?.[0]

      const retrySlug = String(retry?.slug || '').trim()
      if (retrySlug) {
        console.log('[ANIME] detail reintento con slug API:', retrySlug)
        data = await animeApi(
          'detail',
          { slug: retrySlug },
          { timeoutMs: 240000 }
        )
        slug = retrySlug
      } else {
        throw error
      }
    } else {
      throw error
    }
  }

  const anime = data.anime || {}
  const episodes = (data.episodes || [])
    .filter(item => item?.available !== false && Number(item?.episode) > 0)

  if (!episodes.length) {
    throw new Error(
      `No encontré episodios disponibles para "${cleanText(anime.titulo) || slug}".`
    )
  }

  const prefix = prefixOf(ctx)
  const episodeToken = saveSelection('anime-episodes-v2', {
    slug,
    title: cleanText(anime.titulo) || selectedTitle || slug,
    episodes
  })
  const rows = episodes.map((item, index) => ({
    header: `Episodio ${item.episode}`,
    title: `📺 ${cleanText(item.title) || `Episodio ${item.episode}`}`.slice(0, 90),
    description: item.available === false ? 'No disponible' : 'Descargar episodio',
    id: `${prefix}animeepisode ${episodeToken} ${index}`
  }))

  rows.push({
    header: 'Catálogo',
    title: '📋 Volver al Catálogo Anime',
    description: 'Explorar otras opciones',
    id: `${prefix}anime`
  })

  const title = cleanText(anime.titulo) || slug

  await sendInteractive(
    ctx.sock,
    ctx.chat,
    {
      title: `🌸 ${title}`.slice(0, 100),
      body: [
        `📺 Episodios disponibles: *${data.available_count ?? episodes.length}*`,
        `✅ Verificados: *${data.verified_count ?? episodes.length}*`,
        '',
        'Selecciona el capítulo que deseas ver.'
      ].join('\n'),
      footer: NERO_CREDIT,
      media: anime.imagen_portada
        ? { image: { url: anime.imagen_portada } }
        : null,
      buttons: [singleSelect('📺 Ver Episodios', rowSections(rows, 'Episodios'))]
    },
    ctx.msg
  )
}

function animeCooldownMessage(left) {
  const totalSeconds = Math.max(1, Math.ceil(left / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return [
    'Solo puedes iniciar 1 descarga de anime cada 30 minutos.',
    `Espera: ${minutes} min ${seconds} s`
  ].join('\n')
}

async function runAnimeDownloadWithCooldown(ctx, task) {
  const limited = !ctx.isOwner && !ctx.isSubOwner

  if (limited) {
    const until = animeCooldown.get(ctx.sender) || 0
    const left = until - Date.now()

    if (left > 0) throw new Error(animeCooldownMessage(left))

    if (animeActive.has(ctx.sender)) {
      throw new Error('Solo puedes tener una descarga de anime en curso a la vez.')
    }

    animeActive.add(ctx.sender)
  }

  try {
    await runDownloadJob(ctx, 'heavy', '.anime', task)
    if (limited) animeCooldown.set(ctx.sender, Date.now() + ANIME_WAIT)
  } finally {
    if (limited) animeActive.delete(ctx.sender)
  }
}

export const anime = wrap(
  'anime',
  ['animesub', 'animecatalogo', 'animecatalog'],
  'Abre el catálogo de anime o busca uno por nombre.',
  async ctx => {
    const query = String(ctx.args?.join(' ') || '').trim()
    if (!query) {
      await sendAnimeCatalog(ctx)
      return
    }
    await sendAnimeSearch(ctx, query)
  }
)

export const animeQuery = wrap(
  'animequery',
  [],
  'Busca un anime seleccionado desde un catálogo.',
  async ctx => {
    const query = cleanText(decodeArg(ctx.args?.[0]))
    if (!query) throw new Error('La selección de anime no es válida.')
    await sendAnimeSearch(ctx, query)
  }
)

export const animePick = wrap(
  'animepick',
  [],
  'Muestra los episodios de un anime.',
  async ctx => {
    const tokenOrSlug = String(ctx.args?.[0] || '').trim()
    const index = Number(ctx.args?.[1])
    const cached = getSelection(tokenOrSlug, 'anime-search-v2')
    const selected = cached?.[index]

    if (selected?.slug) {
      const slug = String(selected.slug).trim()
      if (!slug) throw new Error('La selección de anime no es válida.')
      await sendAnimeDetail(ctx, slug, cleanText(selected.title))
      return
    }

    // Compatibilidad temporal con botones generados por v1.18.0.
    const legacySlug = cleanSlug(tokenOrSlug)
    if (!legacySlug) throw new Error('La selección de anime venció. Busca nuevamente.')
    await sendAnimeDetail(ctx, legacySlug)
  }
)

export const animeEpisode = wrap(
  'animeepisode',
  ['animeep'],
  'Descarga un episodio seleccionado.',
  async ctx => {
    const tokenOrSlug = String(ctx.args?.[0] || '').trim()
    const indexOrEpisode = Number(ctx.args?.[1])
    const cached = getSelection(tokenOrSlug, 'anime-episodes-v2')

    let slug = ''
    let episode = 0

    if (cached?.slug && Array.isArray(cached?.episodes)) {
      const selectedEpisode = cached.episodes[indexOrEpisode]
      slug = String(cached.slug || '').trim()
      episode = Number(selectedEpisode?.episode || 0)
    } else {
      // Compatibilidad temporal con botones antiguos.
      slug = cleanSlug(tokenOrSlug)
      episode = indexOrEpisode
    }

    if (!slug || !Number.isInteger(episode) || episode < 1) {
      throw new Error('La selección del episodio venció. Abre nuevamente la lista.')
    }

    await runAnimeDownloadWithCooldown(ctx, async () => {
      await ctx.sock.sendMessage(
        ctx.chat,
        {
          text: [
            '🌸 *Preparando episodio*',
            '',
            `Episodio: *${episode}*`,
            '',
            `> ${NERO_CREDIT}`
          ].join('\n')
        },
        { quoted: ctx.msg }
      ).catch(() => {})

      const data = await animeApi('episode', {
        slug,
        episode
      }, { timeoutMs: 240000 })

      const animeInfo = data.anime || {}
      const result = data.result || {}
      const url = result.download_url || result.stream_url
      if (!url) throw new Error('La API no entregó el archivo del episodio.')

      const title = cleanText(animeInfo.titulo) || slug
      const episodeTitle = cleanText(result.title) || `${title} - Episodio ${episode}`
      const filename = cleanText(result.filename) || `${title} - Episodio ${episode}.mp4`

      await sendLargeVideoAsDocuments(
        ctx.sock,
        ctx.chat,
        {
          url,
          title: episodeTitle,
          filename,
          caption: [
            `🌸 *${title}*`,
            `📺 Episodio ${episode}`,
            result.filesize ? `📦 ${result.filesize}` : '',
            '',
            `> ${NERO_CREDIT}`
          ].filter(Boolean).join('\n'),
          quoted: ctx.msg,
          singleDocumentMaxBytes: ANIME_SINGLE_DOCUMENT_BYTES,
          splitPartBytes: ANIME_SPLIT_PART_BYTES,
          silent: true
        }
      )
    })

    await ctx.sock.sendMessage(
      ctx.chat,
      {
        text: [
          '✅ *Episodio enviado*',
          `Episodio: *${episode}*`,
          '',
          `> ${NERO_CREDIT}`
        ].join('\n')
      },
      { quoted: ctx.msg }
    ).catch(() => {})
  }
)

export const animeAiring = wrap(
  'animeairing',
  ['animesestreno', 'animeestrenos'],
  'Muestra animes en estreno desde el catálogo.',
  async ctx => sendAnimeDiscovery(ctx, {
    action: 'schedule',
    title: '📡 ANIMES EN ESTRENO 📡',
    icon: '📡',
    limit: ANIME_AIRING_LIMIT,
    includeBackToMovieCatalog: true
  })
)

export const animenews = wrap(
  'animenews',
  ['noticiasanime'],
  'Consulta noticias recientes de anime.',
  async ctx => {
    const data = await animeApi('news', { limit: 10 })
    const list = (data.results || []).slice(0, 10)
    if (!list.length) throw new Error('No encontré noticias de anime.')

    const text = list.map((item, index) => [
      `${index + 1}. *${cleanText(item.title) || 'Noticia de anime'}*`,
      item.source_url || ''
    ].filter(Boolean).join('\n')).join('\n\n')

    await ctx.sock.sendMessage(
      ctx.chat,
      {
        text: [
          '📰 *NOTICIAS ANIME*',
          '',
          text,
          '',
          `> ${NERO_CREDIT}`
        ].join('\n')
      },
      { quoted: ctx.msg }
    )
  }
)

export const animeTrending = wrap(
  'animetrending',
  ['tendenciasanime'],
  'Muestra animes en tendencia.',
  async ctx => sendAnimeDiscovery(ctx, {
    action: 'trending',
    title: '🔥 ANIMES EN TENDENCIA',
    icon: '🔥',
    limit: 10
  })
)

export const animeschedule = wrap(
  'animeschedule',
  ['horarioanime', 'estrenosanime'],
  'Consulta próximos estrenos de anime.',
  async ctx => sendAnimeDiscovery(ctx, {
    action: 'schedule',
    title: '📅 PRÓXIMOS ESTRENOS',
    icon: '📺',
    limit: 10
  })
)

export const animeLatest = wrap(
  'animelatest',
  ['animeultimo', 'animereciente'],
  'Muestra episodios y animes recientes.',
  async ctx => sendAnimeDiscovery(ctx, {
    action: 'latest',
    title: '🆕 EPISODIOS RECIENTES',
    icon: '🆕',
    limit: 10
  })
)

export const animeHelp = wrap(
  'animehelp',
  [],
  'Explica cómo buscar anime.',
  async ctx => {
    const prefix = prefixOf(ctx)
    await ctx.sock.sendMessage(
      ctx.chat,
      {
        text: [
          '🔎 *BUSCAR ANIME*',
          '',
          `Escribe: *${prefix}anime <nombre>*`,
          '',
          `Ejemplo: *${prefix}anime Shigatsu wa Kimi no Uso*`,
          '',
          `> ${NERO_CREDIT}`
        ].join('\n')
      },
      { quoted: ctx.msg }
    )
  }
)

function mediaUrl(data) {
  return data?.result || data?.url || data?.data?.url || data?.data?.result
}

export const neko = wrap('neko', [], 'Envía una imagen neko aleatoria.', async ctx => {
  const data = await evoGet('/sfw/neko')
  const url = mediaUrl(data)
  if (!url) throw new Error('La API no entregó imagen.')
  await ctx.sock.sendMessage(
    ctx.chat,
    { image: { url }, caption: '🐾 Neko aleatoria' },
    { quoted: ctx.msg }
  )
})

export const bluearchive = wrap('bluearchive', ['ba'], 'Envía una imagen de Blue Archive.', async ctx => {
  const data = await evoGet('/sfw/bluearchive')
  const url = mediaUrl(data)
  if (!url) throw new Error('La API no entregó imagen.')
  await ctx.sock.sendMessage(
    ctx.chat,
    { image: { url }, caption: '💙 Blue Archive' },
    { quoted: ctx.msg }
  )
})

export const angry = wrap('angry', [], 'Envía una reacción anime de enojo.', async ctx => {
  const data = await evoGet('/sfw/rnd/v2', { type: 'angry' })
  const url = mediaUrl(data)
  if (!url) throw new Error('La API no entregó reacción.')
  await ctx.sock.sendMessage(
    ctx.chat,
    { video: { url }, gifPlayback: true, caption: '😡 Está muy enojado/a.' },
    { quoted: ctx.msg }
  )
})

export const animeCommands = [
  anime,
  animeQuery,
  animePick,
  animeEpisode,
  animeAiring,
  animenews,
  animeTrending,
  animeschedule,
  animeLatest,
  animeHelp,
  neko,
  bluearchive,
  angry
]
