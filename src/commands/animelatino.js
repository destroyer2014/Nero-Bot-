import { apiGet } from '../lib/api.js'
import config from '../../config.js'
import { sendInteractive, singleSelect } from '../lib/interactive.js'
import { saveSelection, getSelection } from '../lib/selectionCache.js'
import { runDownloadJob } from '../lib/downloadQueue.js'
import { sendLargeVideoAsDocuments } from '../lib/largeMedia.js'
import { pickDownloadUrl } from '../lib/media.js'

const NERO_CREDIT = 'Nero AI™ | ©ArcadiaCorps'
const ANIMELAT_LIST_LIMIT = 20
const ANIMELAT_SINGLE_DOCUMENT_BYTES = Math.max(
  100,
  Number(process.env.ANIME_SINGLE_DOCUMENT_MB || 700)
) * 1024 * 1024
const ANIMELAT_SPLIT_PART_BYTES = Math.max(
  100,
  Number(process.env.ANIME_SPLIT_PART_MB || 700)
) * 1024 * 1024
const ANIMELAT_MAX_SOURCE_BYTES = Math.max(
  1024,
  Number(process.env.ANIME_MAX_SOURCE_MB || 6144)
) * 1024 * 1024

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
      console.error(`[ANIMELAT:${name}]`, error?.message || error)
      await ctx.sock.sendMessage(
        ctx.chat,
        { text: `❌ ${error?.message || 'No se pudo completar la consulta de AnimeLatino.'}` },
        { quoted: ctx.msg }
      ).catch(() => {})
    }
  }
})

function rowSections(rows, title = 'Opciones') {
  const chunkSize = 10
  const parts = []
  for (let i = 0; i < rows.length; i += chunkSize) parts.push(rows.slice(i, i + chunkSize))
  return parts.map((part, index) => ({
    title: parts.length > 1 ? `${title} ${index + 1}` : title,
    rows: part
  }))
}

async function animeLatinoList(limit = ANIMELAT_LIST_LIMIT) {
  return apiGet('/animeLatino', { limit })
}

async function animeLatinoDetail(slug) {
  return apiGet('/animeLatino', { anime: slug }, { timeoutMs: 240000 })
}

async function animeLatinoEpisode(slug) {
  return apiGet('/animeLatino', { episode: slug }, { timeoutMs: 240000 })
}

async function sendAnimeLatinoCatalog(ctx) {
  const data = await animeLatinoList()
  const list = (data.results || []).filter(item => item?.slug)
  if (!list.length) throw new Error('No encontré animes en el catálogo por ahora.')

  const prefix = prefixOf(ctx)
  const token = saveSelection('animelat-search', list)
  const rows = list.map((item, index) => ({
    header: `Resultado ${index + 1}`,
    title: `🌸 ${item.title || 'Anime'}`.slice(0, 90),
    description: 'Ver episodios disponibles',
    id: `${prefix}animelatpick ${token} ${index}`
  }))

  const first = list[0]

  await sendInteractive(
    ctx.sock,
    ctx.chat,
    {
      title: '🌸 ANIMELATINO • ÚLTIMOS AGREGADOS',
      body: [
        `Se encontraron *${list.length}* resultados recientes.`,
        '',
        '▶️ Toca el botón para elegir qué deseas ver.'
      ].join('\n'),
      footer: NERO_CREDIT,
      media: first?.cover ? { image: { url: first.cover } } : null,
      buttons: [singleSelect('👀 Ver Catálogo', rowSections(rows, '🌸 AnimeLatino'))]
    },
    ctx.msg
  )
}

async function sendAnimeLatinoDetail(ctx, slug, selectedTitle = '') {
  const data = await animeLatinoDetail(slug)
  const result = data.result || {}
  const episodes = (result.episodes || []).filter(item => item?.slug)

  if (!episodes.length) {
    throw new Error(`No encontré episodios disponibles para "${result.title || selectedTitle || slug}".`)
  }

  const prefix = prefixOf(ctx)
  const episodeToken = saveSelection('animelat-episodes', {
    title: result.title || selectedTitle || slug,
    episodes
  })

  const rows = episodes.map((item, index) => ({
    header: `Episodio ${index + 1}`,
    title: `📺 ${item.title || `Episodio ${index + 1}`}`.slice(0, 90),
    description: 'Descargar episodio',
    id: `${prefix}animelatepisode ${episodeToken} ${index}`
  }))

  await sendInteractive(
    ctx.sock,
    ctx.chat,
    {
      title: `🌸 ${(result.title || slug)}`.slice(0, 100),
      body: [
        `📺 Episodios disponibles: *${episodes.length}*`,
        '',
        'Selecciona el capítulo que deseas ver.'
      ].join('\n'),
      footer: NERO_CREDIT,
      media: result.cover ? { image: { url: result.cover } } : null,
      buttons: [singleSelect('📺 Ver Episodios', rowSections(rows, 'Episodios'))]
    },
    ctx.msg
  )
}

export const animelat = wrap(
  'animelat',
  ['animelatino', 'latanime'],
  'Abre el catálogo de AnimeLatino o busca un anime por su slug.',
  async ctx => {
    const query = String(ctx.args?.join(' ') || '').trim()
    if (!query) {
      await sendAnimeLatinoCatalog(ctx)
      return
    }
    await sendAnimeLatinoDetail(ctx, query, query)
  }
)

export const animelatPick = wrap(
  'animelatpick',
  [],
  'Muestra los episodios de un anime de AnimeLatino.',
  async ctx => {
    const token = String(ctx.args?.[0] || '').trim()
    const index = Number(ctx.args?.[1])
    const cached = getSelection(token, 'animelat-search')
    const selected = cached?.[index]

    if (!selected?.slug) throw new Error('La selección venció. Busca nuevamente con .animelat')
    await sendAnimeLatinoDetail(ctx, selected.slug, selected.title)
  }
)

export const animelatEpisode = wrap(
  'animelatepisode',
  ['animelatep'],
  'Descarga un episodio de AnimeLatino.',
  async ctx => {
    const token = String(ctx.args?.[0] || '').trim()
    const index = Number(ctx.args?.[1])
    const cached = getSelection(token, 'animelat-episodes')
    const episode = cached?.episodes?.[index]

    if (!episode?.slug) throw new Error('La selección del episodio venció. Abre nuevamente la lista.')

    await runDownloadJob(ctx, 'heavy', '.animelat', async () => {
      await ctx.sock.sendMessage(
        ctx.chat,
        {
          text: [
            '🌸 *Preparando episodio*',
            '',
            `${episode.title || 'Episodio'}`,
            '',
            `> ${NERO_CREDIT}`
          ].join('\n')
        },
        { quoted: ctx.msg }
      ).catch(() => {})

      const data = await animeLatinoEpisode(episode.slug)
      const url = pickDownloadUrl(data) || episode.mf_links?.[0]

      if (!url) throw new Error('No encontré una fuente de descarga para ese episodio.')

      const title = cached.title || 'AnimeLatino'
      const episodeTitle = episode.title || title

      await sendLargeVideoAsDocuments(
        ctx.sock,
        ctx.chat,
        {
          url,
          title: episodeTitle,
          filename: `${episodeTitle}.mp4`,
          caption: [
            `🌸 *${title}*`,
            `📺 ${episode.title || ''}`,
            '',
            `> ${NERO_CREDIT}`
          ].filter(Boolean).join('\n'),
          quoted: ctx.msg,
          singleDocumentMaxBytes: ANIMELAT_SINGLE_DOCUMENT_BYTES,
          splitPartBytes: ANIMELAT_SPLIT_PART_BYTES,
          maxSourceBytes: ANIMELAT_MAX_SOURCE_BYTES,
          silent: true
        }
      )
    })

    await ctx.sock.sendMessage(
      ctx.chat,
      {
        text: [
          '✅ *Episodio enviado*',
          '',
          `> ${NERO_CREDIT}`
        ].join('\n')
      },
      { quoted: ctx.msg }
    ).catch(() => {})
  }
)

export const animeLatinoCommands = [animelat, animelatPick, animelatEpisode]
