import config from '../../config.js'
import { prepareWAMessageMedia } from '@itsliaaa/baileys'
import { apiGet, evoGet, ApiError } from '../lib/api.js'
import { sendInteractive, copyButton, quickReply, singleSelect, urlButton } from '../lib/interactive.js'
import { enviarCarrusel } from '../lib/uiBuilder.js'
import { formatBytes, formatDuration, isLikelyUrl, pickDownloadUrl, sendImageAlbum, sendRemoteMedia } from '../lib/media.js'
import { cancelUserJobs, clearWaitingQueues, formatQueueStatus, runDownloadJob } from '../lib/downloadQueue.js'
import { getSelection, saveSelection } from '../lib/selectionCache.js'
import { sendLargeVideoAsDocuments } from '../lib/largeMedia.js'
import { createTaggedAudio, sendTaggedAudio } from '../lib/audioTags.js'
import { recordCommandError, commandErrorMessage } from '../lib/commandErrors.js'
import {
  isDiskSpaceError,
  recoverDiskSpace
} from '../lib/diskGuard.js'
import sharp from 'sharp'
import Webpmux from 'node-webpmux'
import fs from 'node:fs/promises'
import path from 'node:path'

const usage = (name, value) => `Uso: *${config.prefix}${name} ${value}*`
const queryText = args => args.join(' ').trim()
const youtubeUrl = id => `https://www.youtube.com/watch?v=${id}`
const musicUrl = id => `https://music.youtube.com/watch?v=${id}`
const spotifyTrackUrl = id => `https://open.spotify.com/track/${id}`
const NERO_CREDIT = 'Nero AI™ | ©ArcadiaCorps'
const activePrefix = ctx => ctx?.prefix || ctx?.subbotConfig?.prefix || config.prefix
const withNeroCredit = text => `${String(text || '').trim()}\n\n> ${NERO_CREDIT}`.trim()

async function fetchImageBuffer(url, timeoutMs = 20000) {
  if (!url) throw new Error('Portada no disponible.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0', accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' }
    })
    if (!response.ok) throw new Error(`Portada HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) throw new Error('La portada no es una imagen.')
    const source = Buffer.from(await response.arrayBuffer())
    if (!source.length) throw new Error('Portada vacía.')
    return sharp(source).rotate().resize(640, 640, { fit: 'cover' }).jpeg({ quality: 86 }).toBuffer()
  } finally {
    clearTimeout(timer)
  }
}

async function sendMusicDocumentCard(ctx, {
  audioUrl,
  title = 'Canción',
  artist = 'Artista',
  album = '',
  coverUrl = '',
  filename = '',
  mimetype = 'audio/mpeg'
}) {
  if (!audioUrl) {
    throw new Error('No hay un enlace de audio disponible.')
  }

  let tagged = null
  let jpegThumbnail = null
  let mediaUrl = audioUrl
  let finalMimetype = mimetype
  let safeName = String(
    filename || `${artist} - ${title}.${mimetype === 'audio/mp4' ? 'm4a' : 'mp3'}`
  )
    .replace(/[\\/:*?"<>|]+/g, '_')
    .slice(0, 150)

  try {
    tagged = await createTaggedAudio({
      audioUrl,
      title,
      artist,
      album,
      coverUrl,
      filename: `${artist} - ${title}.mp3`
    })

    mediaUrl = tagged.file
    finalMimetype = tagged.mimetype
    safeName = tagged.filename
  } catch (error) {
    console.warn(
      '[MUSIC CARD] No pude incrustar metadata; envío original:',
      error?.message || error
    )
  }

  try {
    const sourceCover = tagged?.coverBuffer ||
      (coverUrl ? await fetchImageBuffer(coverUrl, 30000).catch(() => null) : null)

    if (sourceCover) {
      let quality = 72
      let size = 320

      for (let attempt = 0; attempt < 4; attempt += 1) {
        jpegThumbnail = await sharp(sourceCover)
          .resize(size, size, { fit: 'cover' })
          .jpeg({ quality })
          .toBuffer()

        if (jpegThumbnail.length <= 64 * 1024) break
        quality -= 12
        size = Math.max(180, size - 40)
      }
    }

    const prepared = await prepareWAMessageMedia(
      {
        document: { url: mediaUrl },
        mimetype: finalMimetype,
        fileName: safeName
      },
      {
        upload: ctx.sock.waUploadToServer
      }
    )

    const documentMessage = prepared?.documentMessage
    if (!documentMessage) {
      throw new Error('WhatsApp no pudo preparar la tarjeta del archivo.')
    }

    documentMessage.fileName = safeName
    documentMessage.mimetype = finalMimetype

    if (jpegThumbnail) {
      documentMessage.jpegThumbnail = jpegThumbnail
    }

    await ctx.sock.sendMessage(
      ctx.chat,
      {
        documentMessage,
        raw: true
      },
      { quoted: ctx.msg }
    )
  } finally {
    await tagged?.cleanup?.()
  }
}

let fallbackTikTokCover
async function getFallbackTikTokCover() {
  if (!fallbackTikTokCover) {
    fallbackTikTokCover = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 20, g: 20, b: 24 } }
    }).composite([{
      input: Buffer.from(`<svg width="640" height="640" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="640" fill="#141418"/><text x="320" y="285" text-anchor="middle" fill="#ffffff" font-size="70" font-family="sans-serif" font-weight="700">TikTok</text><text x="320" y="365" text-anchor="middle" fill="#bbbbc4" font-size="34" font-family="sans-serif">Nero Bot</text></svg>`),
      top: 0,
      left: 0
    }]).jpeg({ quality: 90 }).toBuffer()
  }
  return fallbackTikTokCover
}

async function react(sock, msg, emoji) {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }).catch(() => {})
}

async function apiTask(ctx, fn) {
  await react(ctx.sock, ctx.msg, '⏳')
  try { await fn() ; await react(ctx.sock, ctx.msg, '✅') }
  catch (error) {
    console.error('Error en descarga:', error)
    if (isDiskSpaceError(error)) {
      await recoverDiskSpace().catch(() => {})
    }
    const code = recordCommandError({
      sender: ctx.sender,
      chat: ctx.chat,
      text: ctx.text,
      error,
      instanceType: ctx.instanceType || 'principal'
    })
    await ctx.sock.sendMessage(ctx.chat, {
      text: commandErrorMessage(code, error)
    }, { quoted: ctx.msg })
    await react(ctx.sock, ctx.msg, '❌')
  }
}

async function directMedia(ctx, endpoint, params, captionBuilder = null, options = {}) {
  const attempts = Number(options.prepareAttempts || (endpoint === '/spotify' ? 5 : 1))
  let data
  let item
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    data = await apiGet(endpoint, params, options)
    const nested = data.selected || data.result || data.primary_media || data.results?.[0] || {}
    item = { ...data, ...nested, selected: data.selected, result: data.result, results: data.results }
    if (pickDownloadUrl(item)) break
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 1800 * attempt))
  }
  const caption = withNeroCredit(captionBuilder ? captionBuilder(data, item) : `*${data.title || item.title || config.botName}*`)
  await sendRemoteMedia(ctx.sock, ctx.chat, item, { quoted: ctx.msg, caption, forceDocument: options.forceDocument })
}

async function prepareYoutubeAudio(url) {
  let lastError

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const data = await apiGet(
        '/ytmp3',
        { mode: 'link', url },
        { timeoutMs: 180000 }
      )
      const nested =
        data.selected ||
        data.result ||
        data.primary_media ||
        data.results?.[0] ||
        {}
      const item = {
        ...data,
        ...nested,
        selected: data.selected,
        result: data.result,
        results: data.results
      }
      const audioUrl = pickDownloadUrl(item)
      if (audioUrl) return { data, item, audioUrl }
      lastError = new Error('YouTube todavía no entregó el audio.')
    } catch (error) {
      lastError = error
    }

    if (attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 1800 * attempt))
    }
  }

  throw lastError || new Error('No se pudo preparar el audio de YouTube.')
}

async function sendTaggedOrFallback(ctx, {
  audioUrl,
  title,
  artist,
  album,
  year,
  coverUrl,
  filename,
  fallbackItem
}) {
  try {
    await sendTaggedAudio(ctx.sock, ctx.chat, {
      audioUrl,
      title,
      artist,
      album,
      year,
      coverUrl,
      filename,
      quoted: ctx.msg
    })
  } catch (error) {
    console.warn('[AUDIO TAGS] fallback:', error?.message || error)

    await sendRemoteMedia(
      ctx.sock,
      ctx.chat,
      {
        ...(fallbackItem || {}),
        type: 'audio',
        url: audioUrl,
        download_url: audioUrl,
        mime_type: 'audio/mpeg',
        filename
      },
      {
        quoted: ctx.msg,
        caption: withNeroCredit([
          `🎵 *${title || 'Audio'}*`,
          artist ? `👤 ${artist}` : '',
          album ? `💿 ${album}` : ''
        ].filter(Boolean).join('\n'))
      }
    )
  }
}

async function downloadYoutubeAudioTagged(ctx, url, meta = {}) {
  const { data, item, audioUrl } = await prepareYoutubeAudio(url)

  const title =
    meta.title ||
    data.title ||
    item.title ||
    'Audio de YouTube'

  const artist =
    meta.artist ||
    meta.author ||
    meta.channel ||
    data.artist ||
    data.author ||
    data.channel ||
    item.artist ||
    item.author ||
    item.channel ||
    'YouTube'

  const album =
    meta.album ||
    data.album ||
    item.album ||
    'YouTube'

  const coverUrl =
    meta.thumbnail ||
    meta.image ||
    meta.cover ||
    data.thumbnail ||
    data.image ||
    data.cover ||
    item.thumbnail ||
    item.image ||
    item.cover ||
    ''

  const year =
    meta.year ||
    meta.upload_date ||
    meta.published_at ||
    data.year ||
    item.year ||
    ''

  const filename = `${artist} - ${title}.mp3`
    .replace(/[\\/:*?"<>|]+/g, '_')

  await sendTaggedOrFallback(ctx, {
    audioUrl,
    title,
    artist,
    album,
    year,
    coverUrl,
    filename,
    fallbackItem: item
  })
}

async function downloadYtMusicTagged(ctx, url, meta = {}) {
  let data
  let firstError = null

  try {
    data = await apiGet(
      '/ytmusic/download',
      { mode: 'link', url },
      { timeoutMs: 180000 }
    )
  } catch (error) {
    firstError = error
  }

  let nested =
    data?.selected ||
    data?.result ||
    data?.primary_media ||
    data?.results?.[0] ||
    {}

  let item = {
    ...(data || {}),
    ...nested,
    selected: data?.selected,
    result: data?.result,
    results: data?.results
  }

  let audioUrl = pickDownloadUrl(item)

  if (!audioUrl) {
    try {
      data = await apiGet(
        '/ytmusic',
        { mode: 'link', url },
        { timeoutMs: 180000 }
      )

      nested =
        data.selected ||
        data.result ||
        data.primary_media ||
        data.results?.[0] ||
        {}

      item = {
        ...data,
        ...nested,
        selected: data.selected,
        result: data.result,
        results: data.results
      }

      audioUrl = pickDownloadUrl(item)
    } catch (fallbackError) {
      if (firstError) throw firstError
      throw fallbackError
    }
  }

  if (!audioUrl) {
    throw firstError ||
      new Error(
        'YouTube Music no entregó un enlace de audio.'
      )
  }

  const title =
    meta.title ||
    data.title ||
    item.title ||
    'YouTube Music'

  const artist =
    meta.artist ||
    meta.author ||
    data.artist ||
    data.author ||
    item.artist ||
    item.author ||
    'YouTube Music'

  const album =
    meta.album ||
    data.album ||
    item.album ||
    ''

  const coverUrl =
    meta.thumbnail ||
    meta.image ||
    meta.cover ||
    data.thumbnail ||
    data.image ||
    data.cover ||
    item.thumbnail ||
    item.image ||
    item.cover ||
    ''

  const rawFormat = String(
    data.format ||
    item.format ||
    item.ext ||
    'm4a'
  ).toLowerCase()

  const isMp3 =
    rawFormat.includes('mp3') ||
    String(item.mime_type || item.content_type || '')
      .toLowerCase()
      .includes('mpeg')

  const mimetype = isMp3 ? 'audio/mpeg' : 'audio/mp4'
  const extension = isMp3 ? 'mp3' : 'm4a'
  const filename =
    `${artist} - ${title}.${extension}`
      .replace(/[\\/:*?"<>|]+/g, '_')

  await sendMusicDocumentCard(ctx, {
    audioUrl,
    title,
    artist,
    album,
    coverUrl,
    filename,
    mimetype
  })
}

export const play = {
  name: 'play',
  aliases: ['youtube','yt'],
  async execute(ctx) {
    return apiTask(ctx, async () => {
      const q = queryText(ctx.args)
      if (!q) throw new Error(usage('play','<nombre>'))
      const data = await apiGet('/ytsearch', { q, limit: Math.max(1, Number(config.searchLimit || 5)) })
      const item = data.results?.[0]
      if (!item) throw new Error('No encontré resultados en YouTube.')

      const prefix = activePrefix(ctx)
      const duration = formatDuration(item.duration_seconds) || 'No disponible'
      const published = item.upload_date || item.published_at || 'No disponible'
      const author = item.channel || item.author || 'YouTube'
      const url = item.url || youtubeUrl(item.video_id || item.id)

      await sendInteractive(ctx.sock, ctx.chat, {
        title: 'YouTube Downloader',
        body: [
          '╭─「 *YouTube Downloader* 」',
          `│➤ *Título:* ${item.title || 'Sin título'}`,
          `│➤ *Duración:* ${duration}`,
          `│➤ *Publicado:* ${published}`,
          `│➤ *Autor:* ${author}`,
          `│➤ *URL:* ${url}`,
          '╰──────────────'
        ].join('\n'),
        footer: NERO_CREDIT,
        media: item.thumbnail ? { image: { url: item.thumbnail } } : null,
        buttons: [
          quickReply('🎵 Audio', `${prefix}ytaudiopick ${saveSelection('youtube-audio-meta', [{ ...item, url }])} 0`),
          quickReply('🎬 Video', `${prefix}ytmp4 ${url}`)
        ]
      }, ctx.msg)
    })
  }
}

export const playpick = {
  name: 'playpick',
  aliases: [],
  async execute(ctx) {
    return apiTask(ctx, async () => {
      const [token,indexRaw] = ctx.args
      const list = getSelection(token,'youtube')
      const item = list?.[Number(indexRaw)]
      if (!item) throw new Error('La selección venció. Ejecuta .play nuevamente.')

      const prefix = activePrefix(ctx)
      const duration = formatDuration(item.duration_seconds) || 'No disponible'
      const published = item.upload_date || item.published_at || 'No disponible'
      const author = item.channel || item.author || 'YouTube'
      const url = item.url || youtubeUrl(item.video_id || item.id)

      await sendInteractive(ctx.sock, ctx.chat, {
        title: 'YouTube Downloader',
        body: [
          `➤ *Título:* ${item.title || 'Sin título'}`,
          `➤ *Duración:* ${duration}`,
          `➤ *Publicado:* ${published}`,
          `➤ *Autor:* ${author}`,
          `➤ *URL:* ${url}`
        ].join('\n'),
        footer: NERO_CREDIT,
        media: item.thumbnail ? { image: { url: item.thumbnail } } : null,
        buttons: [
          quickReply('🎵 Audio', `${prefix}ytaudiopick ${saveSelection('youtube-audio-meta', [{ ...item, url }])} 0`),
          quickReply('🎬 Video', `${prefix}ytmp4 ${url}`)
        ]
      }, ctx.msg)
    })
  }
}

export const ytsearch = {
  name: 'ytsearch',
  aliases: ['yts','youtubesearch'],
  async execute(ctx) {
    return apiTask(ctx, async () => {
      const q = queryText(ctx.args)
      if (!q) throw new Error(usage('ytsearch','<búsqueda>'))

      const limit = Math.min(8, Math.max(1, Number(config.searchLimit || 5)))
      const data = await apiGet('/ytsearch', { q, limit })
      const list = (data.results || []).slice(0, limit)
      if (!list.length) throw new Error('No encontré resultados en YouTube.')

      const prefix = activePrefix(ctx)
      const sections = list.map((item, index) => {
        const url = item.url || youtubeUrl(item.video_id || item.id)
        const title = `${index + 1} | ${item.title || 'Sin título'}`.slice(0, 90)
        const detail = [
          item.channel || item.author || 'YouTube',
          formatDuration(item.duration_seconds)
        ].filter(Boolean).join(' • ').slice(0, 100)

        return {
          title,
          rows: [
            {
              header: 'Audio',
              title: `🎵 ${item.title || 'Descargar audio'}`.slice(0, 90),
              description: detail,
              id: `${prefix}ytmp3 ${url}`
            },
            {
              header: 'Video',
              title: `🎬 ${item.title || 'Descargar video'}`.slice(0, 90),
              description: detail,
              id: `${prefix}ytmp4 ${url}`
            }
          ]
        }
      })

      const first = list[0]
      await sendInteractive(ctx.sock, ctx.chat, {
        title: 'YouTube Search',
        body: [
          `*Resultados:* ${q}`,
          '',
          'Selecciona un resultado y elige *Audio* o *Video*.'
        ].join('\n'),
        footer: NERO_CREDIT,
        media: first?.thumbnail ? { image: { url: first.thumbnail } } : null,
        buttons: [singleSelect('Seleccionar', sections)]
      }, ctx.msg)
    })
  }
}

export const ytmp3 = {
  name: 'ytmp3',
  aliases: ['ytaudio'],
  async execute(ctx) {
    return apiTask(ctx, async () => {
      const url = ctx.args[0]
      if (!isLikelyUrl(url)) {
        throw new Error(usage('ytmp3', '<enlace de YouTube>'))
      }

      await runDownloadJob(
        ctx,
        'light',
        '.ytmp3',
        () => downloadYoutubeAudioTagged(ctx, url)
      )
    })
  }
}

export const ytaudiopick = {
  name: 'ytaudiopick',
  aliases: [],
  async execute(ctx) {
    return apiTask(ctx, async () => {
      const list = getSelection(ctx.args[0], 'youtube-audio-meta')
      const item = list?.[Number(ctx.args[1])]
      if (!item) {
        throw new Error('La selección de audio venció. Ejecuta .play nuevamente.')
      }

      const url = item.url || youtubeUrl(item.video_id || item.id)
      if (!isLikelyUrl(url)) {
        throw new Error('El resultado seleccionado no tiene un enlace válido.')
      }

      await runDownloadJob(
        ctx,
        'light',
        '.play',
        () => downloadYoutubeAudioTagged(ctx, url, item)
      )
    })
  }
}
function youtubeMediaData(data={}){const nested=data.selected||data.result||data.primary_media||data.results?.[0]||{};return {...data,...nested,selected:data.selected,result:data.result,results:data.results}}
function youtubeMediaSizeBytes(item={}){const b=Number(item.size_bytes||item.filesize_bytes||item.content_length||0);if(b>0)return b;const mb=Number(item.size_mb||item.filesize_mb||0);return mb>0?Math.round(mb*1024*1024):0}
function youtubeMediaDuration(item={}){const n=Number(item.duration_seconds||item.duration_sec||0);if(n>0)return n;const raw=String(item.duration||'');if(!raw.includes(':'))return 0;const p=raw.split(':').map(Number);if(p.some(v=>!Number.isFinite(v)))return 0;return p.length===3?p[0]*3600+p[1]*60+p[2]:p.length===2?p[0]*60+p[1]:0}
async function prepareYoutubeVideo(url,quality){let lastError;for(let attempt=1;attempt<=3;attempt++){try{const data=await apiGet('/ytmp4',{mode:'link',url,quality},{timeoutMs:300000});const item=youtubeMediaData(data);if(pickDownloadUrl(item))return {data,item};lastError=new Error('La API todavía no entregó un enlace de descarga.')}catch(e){lastError=e}if(attempt<3)await new Promise(r=>setTimeout(r,2500*attempt))}throw lastError||new Error('No se pudo preparar el video de YouTube.')}
async function downloadYoutubeVideo(ctx,url,quality){
  const {data,item}=await prepareYoutubeVideo(url,quality);const downloadUrl=pickDownloadUrl(item);if(!downloadUrl)throw new Error('YouTube no entregó un enlace descargable.')
  const title=data.title||item.title||'Video de YouTube',filename=item.filename||item.file_name||`${title}.mp4`,duration=youtubeMediaDuration(item),size=youtubeMediaSizeBytes(item)
  const caption=withNeroCredit([`🎬 *${title}*`,`📺 Calidad: ${data.quality||item.quality||quality}`,duration?`⏱️ Duración: ${formatDuration(duration)}`:'',size?`📦 Tamaño: ${formatBytes(size)}`:''].filter(Boolean).join('\n'))
  const long=duration>=3600,large=size>Number(config.maxUploadBytes||0);let reason=long?'el video dura una hora o más':large?'el archivo supera el tamaño del envío normal':''
  if(!reason){try{await sendRemoteMedia(ctx.sock,ctx.chat,item,{quoted:ctx.msg,caption});return}catch(e){console.warn('[YTMP4] envío normal falló; usando documento:',e?.message||e);reason='WhatsApp no pudo subirlo como video normal'}}
  await ctx.sock.sendMessage(ctx.chat,{text:['⚠️ *Este video no se puede enviar de forma normal.*',`Motivo: ${reason}.`,'','📦 Nero lo descargará al VPS y lo enviará como *archivo MP4*.','🧩 Si supera el límite por archivo, se dividirá automáticamente en varias partes.','⏳ Esta operación permanece dentro de la *cola de descarga pesada*.'].join('\n')},{quoted:ctx.msg}).catch(()=>{})
  await sendLargeVideoAsDocuments(ctx.sock,ctx.chat,{url:downloadUrl,title,filename,caption,quoted:ctx.msg})
}
export const ytmp4={name:'ytmp4',aliases:['ytvideo'],async execute(ctx){return apiTask(ctx,async()=>{
  const url=ctx.args[0]; const quality=ctx.args[1]||'360p'; if(!isLikelyUrl(url)) throw new Error(usage('ytmp4','<enlace> [360p]'))
  await runDownloadJob(ctx,'heavy','.ytmp4',()=>downloadYoutubeVideo(ctx,url,quality))
})}}

function canonicalYoutubePlaylistUrl(value) {
  try {
    const input = new URL(value)
    const list = input.searchParams.get('list')
    if (!list) return value

    const canonical = new URL(
      'https://www.youtube.com/playlist'
    )
    canonical.searchParams.set('list', list)
    return canonical.toString()
  } catch {
    return value
  }
}

async function prepareYoutubePlaylist(url, limit) {
  const cleanUrl = canonicalYoutubePlaylistUrl(url)
  let lastError

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await apiGet(
        '/youtube/playlist',
        { url: cleanUrl, limit },
        { timeoutMs: 180000 }
      )
    } catch (error) {
      lastError = error
      const status = Number(error?.status || 0)

      if (
        ![429, 500, 502, 503, 504].includes(status) ||
        attempt >= 3
      ) {
        break
      }

      await new Promise(resolve =>
        setTimeout(resolve, 1500 * attempt * attempt)
      )
    }
  }

  const listId = (() => {
    try {
      return new URL(cleanUrl).searchParams.get('list') || ''
    } catch {
      return ''
    }
  })()

  if (/^RD/i.test(listId)) {
    throw new Error(
      'Ese enlace parece ser un Mix automático de YouTube y el proveedor no pudo abrirlo como playlist. Prueba con una playlist normal.'
    )
  }

  throw lastError ||
    new Error('No pude abrir esa playlist de YouTube.')
}

export const ytplaylist = {
  name: 'ytplaylist',
  aliases: ['playlistyt','ytpl'],
  async execute(ctx) {
    return apiTask(ctx, async () => {
      const url = ctx.args[0]
      if (!isLikelyUrl(url)) throw new Error(usage('ytplaylist','<url> [límite]'))

      const requested = Number(ctx.args[1] || config.searchLimit || 5)
      const limit = Math.min(10, Math.max(1, Number.isFinite(requested) ? requested : 5))

      const data = await prepareYoutubePlaylist(url, limit)
      const tracks = (data.tracks || []).slice(0, limit)
      if (!tracks.length) throw new Error('No encontré videos disponibles en esa playlist.')

      const prefix = activePrefix(ctx)
      const sections = tracks.map((track, index) => {
        const trackUrl = track.url || youtubeUrl(track.id)
        const detail = [
          track.author || 'YouTube',
          formatDuration(track.duration_seconds)
        ].filter(Boolean).join(' • ').slice(0, 100)

        return {
          title: `${index + 1} | ${track.title || 'Video'}`.slice(0, 90),
          rows: [
            {
              header: 'Audio',
              title: `🎵 ${track.title || 'Audio'}`.slice(0, 90),
              description: detail,
              id: `${prefix}ytmp3 ${trackUrl}`
            },
            {
              header: 'Video',
              title: `🎬 ${track.title || 'Video'}`.slice(0, 90),
              description: detail,
              id: `${prefix}ytmp4 ${trackUrl}`
            }
          ]
        }
      })

      await sendInteractive(ctx.sock, ctx.chat, {
        title: 'YouTube Playlist',
        body: [
          `*${data.title || 'Playlist de YouTube'}*`,
          `Autor: ${data.author || 'No disponible'}`,
          `Mostrando: ${tracks.length}`,
          data.total_available ? `Total disponible: ${data.total_available}` : '',
          '',
          'Elige una pista y selecciona *Audio* o *Video*.'
        ].filter(Boolean).join('\n'),
        footer: NERO_CREDIT,
        media: data.thumbnail ? { image: { url: data.thumbnail } } : null,
        buttons: [singleSelect('Elegir pista', sections)]
      }, ctx.msg)
    })
  }
}

export const yttranscript = {
  name: 'yttranscript',
  aliases: ['transcript','transcripcionyt','yttexto'],
  async execute(ctx) {
    return apiTask(ctx, async () => {
      const url = ctx.args[0]
      const language = String(ctx.args[1] || 'es').trim().toLowerCase()

      if (!isLikelyUrl(url)) {
        throw new Error(usage('yttranscript','<url> [idioma]'))
      }

      const data = await apiGet(
        '/youtube/transcript',
        { url, language, whisper_fallback: true },
        { timeoutMs: 300000 }
      )

      const transcript = String(data.text || '').trim()
      if (!transcript) {
        throw new Error('No encontré una transcripción disponible para ese video.')
      }

      const header = [
        '📝 *YouTube Transcript*',
        `🎬 ${data.title || 'Video de YouTube'}`,
        `👤 ${data.author || 'No disponible'}`,
        `🌐 ${data.language_name || data.language || language}`,
        data.duration_seconds ? `⏱️ ${formatDuration(data.duration_seconds)}` : '',
        '',
        `> ${NERO_CREDIT}`
      ].filter(Boolean).join('\n')

      if (transcript.length <= 3200) {
        await ctx.sock.sendMessage(
          ctx.chat,
          { text: `${header}\n\n${transcript}` },
          { quoted: ctx.msg }
        )
        return
      }

      const safeTitle = String(data.title || 'youtube-transcript')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .slice(0, 80)

      await ctx.sock.sendMessage(ctx.chat, {
        document: Buffer.from(transcript, 'utf8'),
        mimetype: 'text/plain',
        fileName: `${safeTitle}.txt`,
        caption: [
          header,
          '',
          'La transcripción es extensa, así que Nero la envió como archivo TXT.'
        ].join('\n')
      }, { quoted: ctx.msg })
    })
  }
}

export const spotify = {
  name: 'spotify',
  aliases: ['sp', 'spotifydl'],
  async execute(ctx) {
    return apiTask(ctx, async () => {
      const input = queryText(ctx.args)
      if (!input) throw new Error(usage('spotify', '<nombre o enlace>'))

      if (isLikelyUrl(input)) {
        return runDownloadJob(
          ctx,
          'light',
          '.spotify',
          () => downloadSpotifyEvo(ctx, input)
        )
      }

      const data = await evoGet('/search/spotify', { query: input })
      const list = data.result || []
      if (!list.length) throw new Error('No encontré canciones en Spotify.')

      const token = saveSelection('spotify-evo', list)
      const prefix = activePrefix(ctx)
      const rows = list.slice(0, 10).map((r, i) => ({
        header: 'Audio',
        title: `${r.artist || 'Artista'} — ${r.title || 'Canción'}`.slice(0, 90),
        description: [r.album, r.duration].filter(Boolean).join(' • ').slice(0, 100) || 'Descargar canción',
        id: `${prefix}spotifypick ${token} ${i}`
      }))

      await sendInteractive(
        ctx.sock,
        ctx.chat,
        {
          title: 'Spotify Downloader',
          body: `Resultados: *${input}*\nSelecciona una canción.`,
          media: list[0]?.image
            ? { image: { url: list[0].image } }
            : null,
          buttons: [
            singleSelect('Seleccionar', [{ title: 'Canciones', rows }])
          ]
        },
        ctx.msg
      )
    })
  }
}

async function downloadSpotifyEvo(ctx, url, meta = {}) {
  let d = null
  let primaryError = null

  try {
    const response = await evoGet(
      '/dl/spotify',
      { url },
      { timeoutMs: 180000 }
    )

    d =
      response.data ||
      response.result ||
      response ||
      {}
  } catch (error) {
    primaryError = error
    console.warn(
      '[SPOTIFY] EvoGB:',
      error?.message || error
    )
  }

  let audioUrl = pickDownloadUrl(d || {})

  if (!audioUrl) {
    try {
      const fallback = await apiGet(
        '/spotify',
        { mode: 'link', url },
        { timeoutMs: 180000 }
      )

      d = {
        ...(d || {}),
        ...fallback,
        ...(fallback.result || {}),
        ...(fallback.selected || {})
      }

      audioUrl = pickDownloadUrl(d)
    } catch (fallbackError) {
      console.warn(
        '[SPOTIFY] DVYer fallback:',
        fallbackError?.message || fallbackError
      )

      if (primaryError) throw primaryError
      throw fallbackError
    }
  }

  if (!audioUrl) {
    throw primaryError ||
      new Error('La API de Spotify no entregó el audio.')
  }

  const title =
    d.name ||
    d.title ||
    meta.title ||
    'Spotify'

  const artist =
    d.artist ||
    d.artist_name ||
    meta.artist ||
    'Spotify'

  const album =
    d.album ||
    d.album_name ||
    meta.album ||
    ''

  const coverUrl =
    d.image ||
    d.thumbnail ||
    d.cover ||
    d.cover_url ||
    meta.image ||
    meta.thumbnail ||
    meta.cover ||
    ''

  const filename =
    `${artist} - ${title}.mp3`
      .replace(/[\\/:*?"<>|]+/g, '_')

  await sendMusicDocumentCard(ctx, {
    audioUrl,
    title,
    artist,
    album,
    coverUrl,
    filename,
    mimetype: 'audio/mpeg'
  })
}

export const spotifypick = {
  name: 'spotifypick',
  aliases: [],
  async execute(ctx) {
    return apiTask(ctx, async () => {
      const list = getSelection(ctx.args[0], 'spotify-evo')
      const item = list?.[Number(ctx.args[1])]
      if (!item) {
        throw new Error('La selección venció. Ejecuta .spotify nuevamente.')
      }
      if (!item.link) {
        throw new Error('El resultado elegido no contiene un enlace de Spotify.')
      }

      await runDownloadJob(
        ctx,
        'light',
        '.spotify',
        () => downloadSpotifyEvo(ctx, item.link, item)
      )
    })
  }
}

export const ytmusic = {
  name: 'ytmusic',
  aliases: ['ytm'],
  async execute(ctx) {
    return apiTask(ctx, async () => {
      const input = queryText(ctx.args)
      if (!input) throw new Error(usage('ytmusic', '<nombre o enlace>'))

      if (isLikelyUrl(input)) {
        return runDownloadJob(
          ctx,
          'light',
          '.ytmusic',
          () => downloadYtMusicTagged(ctx, input)
        )
      }

      const data = await apiGet('/ytmusic/search', {
        q: input,
        limit: 10
      })
      const list = data.results || []
      if (!list.length) {
        throw new Error('No encontré canciones en YouTube Music.')
      }

      const token = saveSelection('ytmusic', list)
      const prefix = activePrefix(ctx)
      const rows = list.map((r, i) => ({
        header: 'Audio',
        title: `${r.artist || 'Artista'} — ${r.title || 'Canción'}`.slice(0, 90),
        description: [
          r.album || '',
          r.duration ? `• ${r.duration}` : ''
        ].filter(Boolean).join(' ').trim(),
        id: `${prefix}ytmusicpick ${token} ${i}`
      }))

      await sendInteractive(
        ctx.sock,
        ctx.chat,
        {
          title: 'YouTube Music',
          body: `Resultados: *${input}*\nSelecciona una canción.`,
          media: list[0]?.thumbnail
            ? { image: { url: list[0].thumbnail } }
            : null,
          buttons: [
            singleSelect('Seleccionar', [{ title: 'Canciones', rows }])
          ]
        },
        ctx.msg
      )
    })
  }
}

export const ytmusicpick = {
  name: 'ytmusicpick',
  aliases: [],
  async execute(ctx) {
    return apiTask(ctx, async () => {
      const list = getSelection(ctx.args[0], 'ytmusic')
      const item = list?.[Number(ctx.args[1])]
      if (!item) {
        throw new Error('La selección venció. Ejecuta .ytmusic nuevamente.')
      }

      const url = item.music_url || musicUrl(item.video_id)
      if (!isLikelyUrl(url)) {
        throw new Error('El resultado seleccionado no contiene un enlace válido.')
      }

      await runDownloadJob(
        ctx,
        'light',
        '.ytmusic',
        () => downloadYtMusicTagged(ctx, url, item)
      )
    })
  }
}

async function downloadAppleMusic(ctx, url, meta = {}) {
  let data
  let lastError

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      data = await apiGet(
        '/applemusicdl',
        { url },
        { timeoutMs: 180000 }
      )

      if (pickDownloadUrl(data)) break
      lastError = new Error(
        'Apple Music todavía no entregó el audio.'
      )
    } catch (error) {
      lastError = error
    }

    if (attempt < 3) {
      await new Promise(resolve =>
        setTimeout(resolve, 1600 * attempt)
      )
    }
  }

  const nested =
    data?.selected ||
    data?.result ||
    data?.primary_media ||
    data?.results?.[0] ||
    {}

  const item = {
    ...(data || {}),
    ...nested
  }

  const audioUrl = pickDownloadUrl(item)

  if (!audioUrl) {
    throw lastError ||
      new Error(
        'Apple Music no entregó un enlace de audio.'
      )
  }

  const title =
    item.track_name ||
    item.title ||
    meta.track_name ||
    meta.title ||
    'Apple Music'

  const artist =
    item.artist_name ||
    item.artist ||
    meta.artist_name ||
    meta.artist ||
    'Apple Music'

  const album =
    item.album_name ||
    item.album ||
    meta.album_name ||
    meta.album ||
    ''

  const coverUrl =
    item.thumbnail ||
    item.image ||
    item.cover ||
    item.artwork ||
    meta.thumbnail ||
    meta.image ||
    ''

  const rawFormat = String(
    item.format || item.ext || 'mp3'
  ).toLowerCase()

  const isM4a =
    rawFormat.includes('m4a') ||
    rawFormat.includes('mp4') ||
    String(item.mime_type || '')
      .toLowerCase()
      .includes('mp4')

  await sendMusicDocumentCard(ctx, {
    audioUrl,
    title,
    artist,
    album,
    coverUrl,
    filename:
      `${artist} - ${title}.${isM4a ? 'm4a' : 'mp3'}`
        .replace(/[\\/:*?"<>|]+/g, '_'),
    mimetype: isM4a ? 'audio/mp4' : 'audio/mpeg'
  })
}

export const applemusic={name:'applemusic',aliases:['apple','amusic'],async execute(ctx){return apiTask(ctx,async()=>{
  const input=queryText(ctx.args);if(!input)throw new Error(usage('applemusic','<nombre o enlace>'))
  if(isLikelyUrl(input))return runDownloadJob(ctx,'light','.applemusic',()=>downloadAppleMusic(ctx,input))
  const data=await apiGet('/applemusicsearch',{q:input,limit:12})
  const list=(data.results||[]).slice(0,12);if(!list.length)throw new Error('No encontré canciones en Apple Music.')
  const token=saveSelection('applemusic',list)
  const prefix=activePrefix(ctx)
  const rows=list.map((r,i)=>({
    header:r.genre||'Audio',
    title:`${r.artist_name||'Artista'} — ${r.track_name||'Canción'}`.slice(0,90),
    description:[r.album_name,formatDuration(r.duration_seconds)].filter(Boolean).join(' • ').slice(0,100),
    id:`${prefix}applemusicpick ${token} ${i}`
  }))
  await sendInteractive(ctx.sock,ctx.chat,{
    title:'Apple Music Downloader',
    body:`Resultados: *${input}*\nSelecciona una canción.`,
    media:list[0]?.thumbnail?{image:{url:list[0].thumbnail}}:null,
    buttons:[singleSelect('Seleccionar',[{title:'Canciones',rows}])]
  },ctx.msg)
})}}

export const applemusicpick={name:'applemusicpick',aliases:[],async execute(ctx){return apiTask(ctx,async()=>{
  const list=getSelection(ctx.args[0],'applemusic');const item=list?.[Number(ctx.args[1])]
  if(!item)throw new Error('La selección venció. Ejecuta .applemusic nuevamente.')
  const url=item.song_url||item.apple_music_url
  if(!url)throw new Error('El resultado elegido no contiene un enlace de Apple Music.')
  await runDownloadJob(ctx,'light','.applemusic',()=>downloadAppleMusic(ctx,url,item))
})}}

async function apkSearch(ctx, mod = false) {
  const q = queryText(ctx.args)
  if (!q) throw new Error(usage(mod ? 'apkmod' : 'apk', '<nombre>'))

  const endpoint = mod ? '/apkmoddl' : '/apkdl'
  const results = []
  let consecutiveMisses = 0

  for (let pick = 1; pick <= 8; pick += 1) {
    try {
      const d = await apiGet(
        endpoint,
        mod
          ? { q, pick }
          : { mode: 'link', q, pick, prefer: 'auto', lang: 'es' },
        { timeoutMs: 120000 }
      )

      if (
        d?.title &&
        !results.some(item =>
          item.title === d.title &&
          item.version === d.version
        )
      ) {
        results.push({
          ...d,
          _searchQuery: q,
          _pick: pick
        })
      }

      consecutiveMisses = 0
    } catch (error) {
      consecutiveMisses += 1
      if (consecutiveMisses >= 2 && results.length) break
      if (consecutiveMisses >= 3) break
    }
  }

  if (!results.length) {
    throw new Error(
      `No encontré aplicaciones para "${q}". Prueba con otro nombre.`
    )
  }

  const token = saveSelection(mod ? 'apkmod' : 'apk', results)
  const prefix = activePrefix(ctx)

  const rows = results.map((item, index) => ({
    header: mod ? 'APK MOD' : 'APK',
    title: String(item.title || 'Aplicación').slice(0, 90),
    description: [
      'Elegir versión y variante',
      item.version ? `v${item.version}` : ''
    ].filter(Boolean).join(' • ').slice(0, 100),
    id: `${prefix}${mod ? 'apkmodpick' : 'apkpick'} ${token} ${index}`
  }))

  await sendInteractive(
    ctx.sock,
    ctx.chat,
    {
      title: mod ? 'Resultados APK MOD' : 'Resultados APK',
      body: [
        `Búsqueda: *${q}*`,
        '',
        'Selecciona una aplicación para ver la versión disponible.'
      ].join('\n'),
      footer: NERO_CREDIT,
      media: results[0]?.icon
        ? { image: { url: results[0].icon } }
        : null,
      buttons: [
        singleSelect(
          'Ver resultados',
          [{
            title: mod ? 'APK MOD' : 'APK',
            rows
          }]
        )
      ]
    },
    ctx.msg
  )
}

async function apkPick(ctx,mod=false){
  const list=getSelection(ctx.args[0],mod?'apkmod':'apk'); let d=list?.[Number(ctx.args[1])]; if(!d) throw new Error('La selección venció. Busca nuevamente.')
  const endpoint=mod?'/apkmoddl':'/apkdl'
  if(d._searchQuery&&d._pick){
    try{
      const fresh=await apiGet(endpoint,mod?{q:d._searchQuery,pick:d._pick}:{mode:'link',q:d._searchQuery,pick:d._pick,prefer:'auto',lang:'es'},{timeoutMs:180000})
      d={...d,...fresh,_searchQuery:d._searchQuery,_pick:d._pick}
    }catch(error){ console.warn('APK: no se pudo renovar el enlace:',error?.message||error) }
  }
  const size=Number(d.size_bytes||d.filesize_bytes||0); const details=[`*Título:* ${d.title}`,`*Versión:* ${d.version||'No disponible'}`,`*Formato:* ${d.format||'APK'}`,`*Tamaño:* ${size ? formatBytes(size) : (d.filesize || 'No disponible')}`,`*Android:* ${d.requirements||'No disponible'}`,`*Actualizado:* ${d.published_at||'No disponible'}`,`*Desarrollador:* ${d.developer||'No disponible'}`]
  if(mod){ if(d.mod_features?.length) details.push(`*Funciones MOD:* ${d.mod_features.join(', ')}`); if(d.mod_changes?.length) details.push(`*Cambios MOD:* ${d.mod_changes.join(', ')}`) }
  await ctx.sock.sendMessage(ctx.chat,{image:d.icon?{url:d.icon}:undefined,text:d.icon?undefined:details.join('\n'),caption:d.icon?details.join('\n'):undefined},{quoted:ctx.msg})
  await runDownloadJob(ctx,'heavy',mod?'.apkmod':'.apk',async()=>{
    let file
    let lastError
    for(let cycle=1;cycle<=4&&!file;cycle+=1){
      if(cycle>1&&d._searchQuery&&d._pick){
        try{
          const fresh=await apiGet(endpoint,mod?{q:d._searchQuery,pick:d._pick}:{mode:'link',q:d._searchQuery,pick:d._pick,prefer:'auto',lang:'es',nonce:Date.now()},{timeoutMs:180000})
          d={...d,...fresh,_searchQuery:d._searchQuery,_pick:d._pick}
        }catch(error){ lastError=error }
      }
      const urls=collectDownloadUrls(d)
      if(!urls.length) lastError=new Error('La API no entregó un enlace de descarga para el APK.')
      for(const url of urls){
        try{ file=await fetchBinaryFile(url,180000,2); break }
        catch(error){ lastError=error; console.warn(`APK: intento ${cycle} falló con ${url}:`,error?.message||error) }
      }
      if(!file&&cycle<4) await wait(1800*cycle)
    }
    if(!file){
      const reason=lastError?.message||'error desconocido'
      throw new Error(`El servidor de descarga del APK no respondió después de varios intentos (${reason}). Intenta nuevamente en unos minutos.`)
    }
    const filename=(d.filename||`${d.title||'aplicacion'}.apk`).replace(/[\/:*?"<>|]+/g,'_')
    await ctx.sock.sendMessage(ctx.chat,{
      document:file.buffer,
      mimetype:'application/vnd.android.package-archive',
      fileName:filename.toLowerCase().endsWith('.apk')?filename:`${filename}.apk`,
      caption:`${mod?'APK MOD':'APK'} • ${d.title}`
    },{quoted:ctx.msg})
  })
}
export const apk={name:'apk',aliases:['apkdl'],async execute(ctx){return apiTask(ctx,()=>apkSearch(ctx,false))}}
export const apkpick={name:'apkpick',aliases:[],async execute(ctx){return apiTask(ctx,()=>apkPick(ctx,false))}}
export const apkmod={name:'apkmod',aliases:['modapk'],async execute(ctx){return apiTask(ctx,()=>apkSearch(ctx,true))}}
export const apkmodpick={name:'apkmodpick',aliases:[],async execute(ctx){return apiTask(ctx,()=>apkPick(ctx,true))}}

function simpleLinkCommand(name,aliases,endpoint,paramsBuilder,captionBuilder,forceDocument=false,queueType='heavy'){return {name,aliases,async execute(ctx){return apiTask(ctx,async()=>{const url=ctx.args[0];if(!isLikelyUrl(url))throw new Error(usage(name,'<enlace>'));await runDownloadJob(ctx,queueType,`${config.prefix}${name}`,()=>directMedia(ctx,endpoint,paramsBuilder(url,ctx.args),captionBuilder,{forceDocument}))})}}}
export const facebook=simpleLinkCommand('facebook',['fb'],'/facebook',(url,args)=>({mode:'link',url,quality:args[1]||'auto'}),d=>`🎬 *${d.title||'Facebook Video'}*\n📺 ${d.quality||'Auto'}\n⏱️ ${d.duration||''}`)
export const instagram=simpleLinkCommand('instagram',['ig'],'/instagram',(url,args)=>({mode:'link',url,pick:args[1]||1,lang:'es'}),d=>`📸 *${d.title||'Instagram'}*\n👤 @${d.username||'usuario'}`)
export const twitch=simpleLinkCommand('twitch',['twitchdl'],'/twitch/download',url=>({url}),d=>`🎮 *${d.title||'Twitch'}*\n👤 ${d.author||''}\n⏱️ ${formatDuration(d.duration_seconds)||''}`)
export const reddit=simpleLinkCommand('reddit',['redditdl'],'/reddit/download',url=>({url}),d=>`👽 *${d.title||'Reddit'}*\n🎞️ ${d.type||'media'}`)
export const bilibili=simpleLinkCommand('bilibili',['bilidl','bili'],'/bilibili/download',url=>({url}),d=>`📺 *${d.title||'Bilibili'}*\n👤 ${d.author||''}\n⏱️ ${formatDuration(d.duration_seconds)||''}`)
export const mediafire=simpleLinkCommand('mediafire',['mf'],'/mediafire',url=>({mode:'link',url}),d=>`📁 *${d.filename||d.title}*\n📦 ${d.filesize||''}`,true)
export const mega=simpleLinkCommand('mega',['mg'],'/mega',url=>({mode:'link',url}),d=>`☁️ *${d.filename||d.title}*\n📦 ${d.filesize||formatBytes(d.filesize_bytes)}`,true)

export const threads={name:'threads',aliases:['savethreads'],async execute(ctx){return apiTask(ctx,async()=>{const url=ctx.args[0];if(!isLikelyUrl(url))throw new Error(usage('threads','<enlace>'));await runDownloadJob(ctx,'heavy','.threads',async()=>{const d=await apiGet('/savethreads',{mode:'link',url,quality:'best',pick:ctx.args[1]||1});const items=d.downloads?.length?d.downloads:[d];for(const item of items.slice(0,10))await sendRemoteMedia(ctx.sock,ctx.chat,item,{quoted:ctx.msg,caption:d.description||d.title||'Threads'})})})}}
export const universal={name:'universal',aliases:['dl'],async execute(ctx){return apiTask(ctx,async()=>{const url=ctx.args[0];if(!isLikelyUrl(url))throw new Error(usage('dl','<enlace>'));await runDownloadJob(ctx,'heavy','.dl',async()=>{const d=await apiGet('/universal',{mode:'link',url});const items=d.downloads?.length?d.downloads:(d.media?.length?d.media:[d]);for(const item of items.slice(0,10))await sendRemoteMedia(ctx.sock,ctx.chat,item,{quoted:ctx.msg,caption:d.title||`${d.platform||'Universal'}`})})})}}
export const pinterest={name:'pinterest',aliases:['pin','pindl'],async execute(ctx){return apiTask(ctx,async()=>{const input=queryText(ctx.args);if(!input)throw new Error(usage('pinterest','<enlace>'));if(!isLikelyUrl(input))throw new Error(`Para buscar usa *${config.prefix}pinterestsearch <nombre>*`);const d=await apiGet('/universal',{mode:'link',url:input});const items=d.downloads?.length?d.downloads:(d.media?.length?d.media:[d]);for(const item of items.slice(0,10))await sendRemoteMedia(ctx.sock,ctx.chat,item,{quoted:ctx.msg,caption:d.title||'Pinterest'})})}}

export const pinterestSearch={name:'pinterestsearch',aliases:['pinsearch'],async execute(ctx){return apiTask(ctx,async()=>{const input=queryText(ctx.args);if(!input)throw new Error(usage('pinterestsearch','<búsqueda>'));const response=await evoGet('/search/pinterestv3',{query:input});const list=(response.data?.images||[]).slice(0,10);if(!list.length)throw new Error('No encontré resultados en Pinterest.');const items=list.map(item=>({type:'image',title:item.title||'Pinterest',download_url:item.images?.orig||item.images?.['736x']||item.images?.['474x']||item.images?.['236x']}));await sendImageAlbum(ctx.sock,ctx.chat,items,{quoted:ctx.msg,caption:`📌 *Pinterest Search*
Búsqueda: ${input}
Resultados: ${items.length}`})})}}


export const stickerSearch={name:'stickersearch',aliases:['stickerssearch','stickerly'],async execute(ctx){return apiTask(ctx,async()=>{
  const input=queryText(ctx.args)
  if(!input)throw new Error(usage('stickersearch','<nombre>'))
  const response=await evoGet('/stickerly/search',{query:input})
  const list=(response.resultados||response.results||response.data||[]).slice(0,12)
  if(!list.length)throw new Error('No encontré paquetes de stickers.')

  const token=saveSelection('stickerly-pack',list)
  const rows=list.map((item,index)=>({
    header:item.isAnimated?'Paquete animado':'Paquete estático',
    title:(item.name||'Paquete sin nombre').slice(0,80),
    description:`${item.author||'Autor desconocido'} • ${item.stickerCount??'?'} stickers${item.isPaid?' • De pago':''}`.slice(0,100),
    id:`${config.prefix}stickerpack ${token} ${index}`
  }))

  const first=list[0]
  await sendInteractive(ctx.sock,ctx.chat,{
    title:'Sticker.ly Search',
    body:`Resultados para: *${input}*\nSelecciona un paquete para descargarlo y enviarlo.`,
    media:first?.thumbnailUrl?{image:{url:first.thumbnailUrl}}:null,
    buttons:[singleSelect('Seleccionar paquete',[{title:'Paquetes encontrados',rows}])]
  },ctx.msg)
})}}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function applyStickerPackMeta(buffer, packname, author) {
  const image = new Webpmux.Image()
  await image.load(buffer)
  const metadata = {
    'sticker-pack-id': `nero-${Date.now()}`,
    'sticker-pack-name': packname || 'Nero Bot',
    'sticker-pack-publisher': author || 'ArcadiaCorps',
    emojis: ['✨']
  }
  const exifHeader = Buffer.from([
    0x49,0x49,0x2a,0x00,0x08,0x00,0x00,0x00,0x01,0x00,0x41,0x57,
    0x07,0x00,0x00,0x00,0x00,0x00,0x16,0x00,0x00,0x00
  ])
  const json = Buffer.from(JSON.stringify(metadata), 'utf8')
  exifHeader.writeUIntLE(json.length, 14, 4)
  image.exif = Buffer.concat([exifHeader, json])
  return image.save(null)
}

function collectDownloadUrls(data = {}) {
  const keys = [
    'proxy_download_url_full', 'proxy_download_url',
    'download_url_full', 'stream_url_full', 'direct_url',
    'download_url', 'stream_url', 'url'
  ]
  const found = []
  const seenObjects = new Set()
  const seenUrls = new Set()
  const queue = [data]
  while (queue.length) {
    const value = queue.shift()
    if (!value || typeof value !== 'object' || seenObjects.has(value)) continue
    seenObjects.add(value)
    for (const key of keys) {
      const candidate = value[key]
      if (typeof candidate !== 'string' || !candidate.trim()) continue
      try {
        const absolute = new URL(candidate, config.apiBaseUrl).toString()
        if (!seenUrls.has(absolute)) { seenUrls.add(absolute); found.push(absolute) }
      } catch {}
    }
    if (Array.isArray(value)) queue.push(...value)
    else queue.push(...Object.values(value).filter(child => child && typeof child === 'object'))
  }
  return found
}

async function fetchBinaryFile(url, timeoutMs = 180000, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'user-agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36',
          accept: 'application/vnd.android.package-archive,application/octet-stream,*/*',
          'accept-encoding': 'identity'
        }
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (!buffer.length) throw new Error('Archivo vacío')
      return { buffer, contentType: response.headers.get('content-type') || '' }
    } catch (error) {
      lastError = error
      if (attempt < attempts) await wait(1200 * attempt)
    } finally { clearTimeout(timer) }
  }
  throw lastError
}

export const stickerPack={name:'stickerpack',aliases:['stickerdetail'],async execute(ctx){return apiTask(ctx,async()=>{
  const [token,indexRaw]=ctx.args
  const list=getSelection(token,'stickerly-pack')
  const selected=list?.[Number(indexRaw)]
  if(!selected)throw new Error('La selección venció. Ejecuta .stickersearch nuevamente.')
  if(!selected.url)throw new Error('El paquete elegido no incluye un enlace válido.')

  const response=await evoGet('/stickerly/detail',{url:selected.url},{timeoutMs:120000})
  const detail=response.detalles||response.details||response.data||{}
  const stickers=Array.isArray(detail.stickers)?detail.stickers.slice(0,30):[]
  const packName=detail.name||selected.name||'Sticker.ly'
  const packAuthor=detail.author?.name||detail.author?.username||selected.author||'Nero Bot'
  if(!stickers.length)throw new Error('El paquete no contiene stickers descargables.')

  await ctx.sock.sendMessage(ctx.chat,{text:[
    '⏳ *Descargando paquete de Sticker.ly*',
    `Paquete: ${packName}`,
    `Autor: ${packAuthor}`,
    `Stickers: ${stickers.length}`
  ].join('\n')},{quoted:ctx.msg})

  let sent=0
  let failed=0
  for(const item of stickers){
    try{
      if(!item.imageUrl)throw new Error('URL vacía')
      const response=await fetch(item.imageUrl,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0'}})
      if(!response.ok)throw new Error(`HTTP ${response.status}`)
      const buffer=Buffer.from(await response.arrayBuffer())
      if(!buffer.length)throw new Error('Sticker vacío')
      const stickerBuffer=await applyStickerPackMeta(buffer,packName,packAuthor)
      await ctx.sock.sendMessage(ctx.chat,{sticker:stickerBuffer},{quoted:sent===0?ctx.msg:undefined})
      sent+=1
      await wait(450)
    }catch(error){
      failed+=1
      console.error('Sticker.ly: no se pudo enviar sticker:',error?.message||error)
    }
  }

  if(!sent)throw new Error('No se pudo enviar ningún sticker del paquete.')
  await ctx.sock.sendMessage(ctx.chat,{text:`✅ *Paquete importado*\nNombre: ${packName}\nAutor: ${packAuthor}\nEnviados: ${sent}/${stickers.length}${failed?`\nFallidos: ${failed}`:''}`},{quoted:ctx.msg})
})}}


export const tiktok={name:'tiktok',aliases:['tt'],async execute(ctx){return apiTask(ctx,async()=>{const url=ctx.args[0];if(!isLikelyUrl(url))throw new Error(usage('tiktok','<enlace>'));await runDownloadJob(ctx,'heavy','.tiktok',async()=>{const response=await evoGet('/dl/tiktok',{url},{timeoutMs:180000});const d=response.data||{};if(!d.dl)throw new Error('TikTok no entregó contenido descargable.');const author=d.author?.nickname||d.author?.unique_id||'TikTok';const caption=withNeroCredit([`${d.type==='image'?'🖼️':'🎵'} *${d.title||'TikTok'}*`,`👤 ${author}${d.author?.unique_id?` (@${d.author.unique_id})`:''}`,d.type==='image'&&Array.isArray(d.dl)?`📷 Fotos: ${d.dl.length}`:`⏱️ ${d.duration||'No disponible'}`,`🌎 ${d.region||'--'}`,d.stats?`▶️ ${d.stats.plays||0}  ❤️ ${d.stats.likes||0}  💬 ${d.stats.comments||0}`:''].filter(Boolean).join('\n'));if(d.type==='image'&&Array.isArray(d.dl)){const items=d.dl.map((image,index)=>({type:'image',download_url:image,title:`TikTok foto ${index+1}`}));await sendImageAlbum(ctx.sock,ctx.chat,items,{quoted:ctx.msg,caption});return}const videoUrl=Array.isArray(d.dl)?d.dl[0]:d.dl;if(!videoUrl)throw new Error('TikTok no entregó el video.');await sendRemoteMedia(ctx.sock,ctx.chat,{type:'video',url:videoUrl,download_url:videoUrl,mime_type:'video/mp4',filename:`TikTok-${d.id||Date.now()}.mp4`},{quoted:ctx.msg,caption})})})}}

function normalizeTikTokSearchItem(item={},provider='unknown'){
  const username=item.username||item.author?.unique_id||item.author?.username||(typeof item.author==='string'?item.author:'')||'usuario'
  const authorName=item.author?.nickname||item.author?.name||(typeof item.author==='string'?item.author:'')||username
  const videoUrl=item.video_url||item.share_url||item.links?.tiktok||item.url||(item.id&&username!=='usuario'?`https://www.tiktok.com/@${username}/video/${item.id}`:'')
  return {
    ...item,
    id:String(item.id||''),
    title:item.title||item.description||'Sin título',
    description:item.description||item.title||'',
    author:{...(item.author&&typeof item.author==='object'?item.author:{}),unique_id:username,nickname:authorName},
    cover:item.cover||item.cover_url||item.thumbnail_url||item.thumbnail||null,
    duration:item.duration??item.duration_seconds??null,
    stats:{...(item.stats||{}),views:item.stats?.views??item.views??0,likes:item.stats?.likes??item.likes??0,comments:item.stats?.comments??item.comments??0,shares:item.stats?.shares??item.shares??0},
    video_url:videoUrl,
    share_url:item.share_url||videoUrl,
    _provider:provider
  }
}

async function searchTikTokWithFallback(input,limit){
  let primaryError=null
  try{
    const response=await apiGet('/tiktok/search',{q:input,limit})
    const list=(response.results||[]).slice(0,limit).map(item=>normalizeTikTokSearchItem(item,'DVYer'))
    if(list.length)return {provider:'DVYer',list}
  }catch(error){primaryError=error;console.warn('[TIKTOK SEARCH] DVYer:',error?.message||error)}

  try{
    const response=await evoGet('/search/tiktok',{query:input})
    const list=(response.data||[]).slice(0,limit).map(item=>normalizeTikTokSearchItem(item,'EvoGB'))
    if(list.length)return {provider:'EvoGB',list}
  }catch(error){
    console.warn('[TIKTOK SEARCH] EvoGB:',error?.message||error)
    if(primaryError)throw new Error(`TikTok Search no está disponible temporalmente. DVYer: ${primaryError?.message||'error'} • EvoGB: ${error?.message||'error'}`)
    throw error
  }
  throw new Error('No encontré resultados en TikTok.')
}

export const tiktokSearch={name:'tiktoksearch',aliases:['ttsearch','tts','tiktoks'],async execute(ctx){return apiTask(ctx,async()=>{
  const input=queryText(ctx.args)
  if(!input)throw new Error(usage('tts','<búsqueda>'))

  const limit=Math.min(
    10,
    Math.max(1,Number(config.searchLimit||5))
  )

  const result=await searchTikTokWithFallback(input,limit)
  const list=result.list

  if(!list.length)throw new Error('No encontré resultados en TikTok.')

  const token=saveSelection('tiktok-search',list)
  const prefix=activePrefix(ctx)

  const rows=list.map((item,index)=>{
    const username=item.author?.unique_id||item.username||'usuario'
    const stats=item.stats||{}
    const duration=item.duration??'--'

    return {
      header:`Resultado ${index+1}`,
      title:(item.title||'Sin título').slice(0,80),
      description:[
        `@${username}`,
        `${duration}s`,
        `${stats.views||0} vistas`
      ].join(' • ').slice(0,100),
      id:`${prefix}ttget ${token} ${index}`
    }
  })

  const first=list[0]

  await sendInteractive(ctx.sock,ctx.chat,{
    title:'TikTok Buscador',
    body:[
      `Resultados para: *${input}*`,
      `Proveedor: *${result.provider}*`,
      '',
      'Selecciona un video de la lista para descargarlo.'
    ].join('\n'),
    footer:NERO_CREDIT,
    media:first?.cover?{image:{url:first.cover}}:null,
    buttons:[
      singleSelect(
        'Ver resultados',
        [{title:'Resultados de TikTok',rows}]
      )
    ]
  },ctx.msg)
})}}

export const tiktokGet={name:'ttget',aliases:['tiktokget','ttselect'],async execute(ctx){return apiTask(ctx,async()=>{
  let token,indexRaw
  if(ctx.args.length>=2)[token,indexRaw]=ctx.args
  else throw new Error('La selección venció o falta el identificador. Ejecuta .tts <búsqueda> nuevamente.')
  const list=getSelection(token,'tiktok-search'),item=list?.[Number(indexRaw)]
  if(!item)throw new Error('La selección venció. Ejecuta .tts <búsqueda> nuevamente.')
  const username=item.author?.unique_id||item.username||'usuario'
  const original=item.video_url||item.share_url||item.links?.tiktok||(item.id&&username!=='usuario'?`https://www.tiktok.com/@${username}/video/${item.id}`:'')
  if(!original)throw new Error('El resultado seleccionado no contiene un enlace válido de TikTok.')
  await tiktok.execute({...ctx,args:[original]})
})}}


export const testcards={name:'testcards',aliases:[],async execute(ctx){if(!ctx.isOwner)throw new Error('Este comando es exclusivo para owners.');return apiTask(ctx,async()=>{
  const imageA=await sharp({create:{width:640,height:640,channels:3,background:'#6d28d9'}}).jpeg().toBuffer()
  const imageB=await sharp({create:{width:640,height:640,channels:3,background:'#be123c'}}).jpeg().toBuffer()
  await enviarCarrusel(ctx.sock,ctx.chat,
    'Prueba exacta del carrusel de Yuta Bot.',
    'Nero Bot • ArcadiaCorps',
    [
      {img:imageA,titulo:'Tarjeta 1',body:'Código exacto de uiBuilder.js de Yuta.',footer:'Nero Bot',botones:[{tipo:'copy',texto:'Copiar',payload:'.menu'}]},
      {img:imageB,titulo:'Tarjeta 2',body:'Desliza horizontalmente para verla.',footer:'Nero Bot',botones:[{tipo:'copy',texto:'Copiar',payload:'.ping'}]}
    ],
    { quoted: null }
  )
})}}
export const testcardsbtn={name:'testcardsbtn',aliases:[],async execute(ctx){return testcards.execute(ctx)}}



export const terabox={name:'terabox',aliases:['tb'],async execute(ctx){return apiTask(ctx,async()=>{const url=ctx.args[0];if(!isLikelyUrl(url))throw new Error(usage('terabox','<enlace>'));const d=await apiGet('/terabox',{url,limit:50});const files=d.files||[];if(!files.length)throw new Error('No encontré archivos en TeraBox.');const token=saveSelection('terabox',files);const rows=files.slice(0,10).map((f,i)=>({header:'Archivo',title:f.file_name.slice(0,90),description:formatBytes(f.size_bytes),id:`${config.prefix}teraboxpick ${token} ${i}`}));await sendInteractive(ctx.sock,ctx.chat,{title:'TeraBox Downloader',body:`Se encontraron ${files.length} archivo(s).`,media:files[0].thumb?{image:{url:files[0].thumb}}:null,buttons:[singleSelect('Seleccionar',[{title:'Archivos',rows}])]},ctx.msg)})}}
export const teraboxpick={name:'teraboxpick',aliases:[],async execute(ctx){return apiTask(ctx,async()=>{const list=getSelection(ctx.args[0],'terabox');const f=list?.[Number(ctx.args[1])];if(!f)throw new Error('La selección venció.');await runDownloadJob(ctx,'heavy','.terabox',()=>sendRemoteMedia(ctx.sock,ctx.chat,{...f,type:'file',filename:f.file_name,url:f.download_url_full},{quoted:ctx.msg,caption:`TeraBox • ${f.file_name}`,forceDocument:true}))})}}

const animeAliases = {
  'rezero': 're-zero-kara-hajimeru-isekai-seikatsu',
  're-zero': 're-zero-kara-hajimeru-isekai-seikatsu',
  're-zero-kara-hajimeru': 're-zero-kara-hajimeru-isekai-seikatsu',
  'sao': 'sword-art-online'
}

function animeSlug(value) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

async function fetchAnime(name) {
  const normalized = animeSlug(name)
  const candidates = [...new Set([animeAliases[normalized], normalized].filter(Boolean))]
  let lastError
  for (const slug of candidates) {
    try { return await apiGet(`/anime/subespanol/${slug}`, { episode_limit: 50 }) }
    catch (error) {
      lastError = error
      console.warn(`Anime: falló slug ${slug}:`, error?.message || error)
    }
  }
  throw lastError || new Error('No encontré ese anime.')
}

const animeCooldown=new Map()
const animeActive=new Set()
const ANIME_WAIT=30*60*1000

function animeCooldownMessage(left){
  const totalSeconds=Math.max(1,Math.ceil(left/1000))
  const minutes=Math.floor(totalSeconds/60)
  const seconds=totalSeconds%60
  return [
    '❌ Solo puedes iniciar 1 descarga de anime cada 30 minutos.',
    `Espera: ${minutes} min ${seconds} s`
  ].join('\n')
}

async function runAnimeDownloadWithCooldown(ctx,task){
  const limited=!ctx.isOwner&&!ctx.isSubOwner

  if(limited){
    const until=animeCooldown.get(ctx.sender)||0
    const left=until-Date.now()

    if(left>0){
      throw new Error(animeCooldownMessage(left))
    }

    if(animeActive.has(ctx.sender)){
      throw new Error(
        'Solo puedes tener una descarga de anime en curso a la vez.'
      )
    }

    animeActive.add(ctx.sender)
  }

  try{
    await runDownloadJob(ctx,'heavy','.anime',task)

    // El cooldown comienza únicamente después de que la descarga
    // terminó correctamente.
    if(limited){
      animeCooldown.set(ctx.sender,Date.now()+ANIME_WAIT)
    }
  }finally{
    if(limited)animeActive.delete(ctx.sender)
  }
}

export const anime={name:'anime',aliases:['animesub'],async execute(ctx){return apiTask(ctx,async()=>{
  const raw=queryText(ctx.args);if(!raw)throw new Error(usage('anime','<nombre> [episodio]'))
  const parts=raw.split(/\s+/);const episode=Number(parts.at(-1));const hasEpisode=Number.isInteger(episode)&&episode>0
  if(hasEpisode)parts.pop()
  const animeName=parts.join(' ')
  let d
  try { d=await fetchAnime(animeName) }
  catch(error){
    const status=Number(error?.status||0)
    const message=String(error?.message||error||'')

    if(
      status===404||
      /(?:anime|recurso).*(?:no encontrado|not found)/i.test(message)||
      /(?:no encontrado|not found).*(?:anime|recurso)/i.test(message)
    ){
      throw new Error(`No encontré el anime "${animeName}".`)
    }

    if([500,502,503,504].includes(status)){
      throw new Error(
        'El servidor de anime está temporalmente ocupado. Inténtalo nuevamente en unos minutos.'
      )
    }

    throw error
  }

  if(!d||typeof d!=='object'){
    throw new Error(`No encontré el anime "${animeName}".`)
  }

  const info=d.anime_info||{}
  const chapters=(d.temporadas||[]).flatMap(t=>t.capitulos||[])

  if(!info.titulo&&!chapters.length){
    throw new Error(`No encontré el anime "${animeName}".`)
  }

  if(info.titulo&&!chapters.length){
    throw new Error(
      `No encontré episodios disponibles para "${info.titulo}".`
    )
  }
  if(!hasEpisode){
    const rows=chapters.slice(0,50).map(c=>({header:`Episodio ${c.capitulo_numero}`,title:c.titulo_capitulo||`Episodio ${c.capitulo_numero}`,description:'Descargar episodio',id:`${config.prefix}anime ${animeName} ${c.capitulo_numero}`}))
    await sendInteractive(ctx.sock,ctx.chat,{title:info.titulo||'Anime',body:`Episodios disponibles: ${chapters.length}`,media:info.imagen_portada?{image:{url:info.imagen_portada}}:null,buttons:[singleSelect('Elegir episodio',[{title:'Episodios',rows}])]},ctx.msg);return
  }
  const c=chapters.find(x=>Number(x.capitulo_numero)===episode);if(!c)throw new Error('No encontré ese episodio.')
  const downloads=(c.enlaces_descarga||[]).map(x=>x.url).filter(Boolean)
  if(!downloads.length) throw new Error('Este episodio no tiene enlaces de descarga disponibles.')
  await runAnimeDownloadWithCooldown(ctx,async()=>{
    await ctx.sock.sendMessage(ctx.chat,{text:`📥 *Descarga iniciada*\n\nAnime: ${info.titulo||animeName}\nEpisodio: ${episode}\nEstado: preparando archivo…`},{quoted:ctx.msg})
    let resolved=null
    let source=''
    let lastError
    for(const originalUrl of downloads){
      try{
        if(/mediafire\.com/i.test(originalUrl)){
          resolved=await apiGet('/mediafire',{mode:'link',url:originalUrl},{timeoutMs:180000}); source='MediaFire'
        }else if(/mega\.nz/i.test(originalUrl)){
          const normalized=originalUrl.replace('/embed/','/file/')
          resolved=await apiGet('/mega',{mode:'link',url:normalized},{timeoutMs:180000}); source='MEGA'
        }else continue
        if(pickDownloadUrl(resolved)) break
        resolved=null
      }catch(error){ lastError=error; resolved=null }
    }
    if(!resolved) throw lastError||new Error('No pude preparar la descarga del episodio.')
    const title=info.titulo||animeName
    const filename=resolved.filename||`${title}_Episodio_${episode}.mp4`
    await ctx.sock.sendMessage(ctx.chat,{text:`🎬 *Enviando episodio, por favor espera…*\nServidor: ${source}`},{quoted:ctx.msg})
    await sendRemoteMedia(ctx.sock,ctx.chat,{...resolved,type:'video',filename,mime_type:'video/mp4'},{quoted:ctx.msg,caption:withNeroCredit(`🎬 *${title}*\nEpisodio ${episode}\nServidor: ${source}`),forceDocument:true})
  })
})}}



export const queueStatus={name:'cola',aliases:['queue'],async execute(ctx){await ctx.sock.sendMessage(ctx.chat,{text:`📥 *Estado de descargas*\n\n${formatQueueStatus()}`},{quoted:ctx.msg})}}
export const cancelDownload={name:'cancelardescarga',aliases:['cancelardl'],async execute(ctx){const removed=cancelUserJobs(ctx.sender);await ctx.sock.sendMessage(ctx.chat,{text:removed?`✅ Se cancelaron ${removed} descarga(s) tuyas en espera.`:'No tienes descargas esperando en la cola.'},{quoted:ctx.msg})}}
export const clearQueue={name:'limpiarcola',aliases:['clearqueue'],async execute(ctx){if(!ctx.isStaff)throw new Error('Este comando es solo para owner y subowner.');const removed=clearWaitingQueues();await ctx.sock.sendMessage(ctx.chat,{text:`✅ Cola limpiada. Solicitudes eliminadas: ${removed}.`},{quoted:ctx.msg})}}

export const downloadCommands=[play,playpick,ytsearch,ytmp3,ytaudiopick,ytmp4,ytplaylist,yttranscript,spotify,spotifypick,ytmusic,ytmusicpick,applemusic,applemusicpick,apk,apkpick,apkmod,apkmodpick,facebook,instagram,twitch,reddit,bilibili,threads,universal,pinterest,pinterestSearch,stickerSearch,stickerPack,tiktok,tiktokSearch,tiktokGet,mediafire,mega,terabox,teraboxpick,anime,queueStatus,cancelDownload,clearQueue]
