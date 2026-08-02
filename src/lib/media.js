import path from 'node:path'
import config from '../../config.js'

export function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return 'Desconocido'
  const units = ['B', 'KB', 'MB', 'GB']
  let amount = bytes, index = 0
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1 }
  return `${amount.toFixed(index ? 2 : 0)} ${units[index]}`
}

export function formatDuration(seconds) {
  const total = Number(seconds)
  if (!Number.isFinite(total)) return null
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`
}

export function isLikelyUrl(value = '') {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) } catch { return false }
}

function absoluteApiUrl(value) {
  if (!value) return null
  try { return new URL(value, config.apiBaseUrl).toString() } catch { return null }
}

export function pickDownloadUrl(data = {}) {
  const priorityKeys = [
    'proxy_download_url_full', 'proxy_download_url',
    'download_url_full', 'download_url', 'download_link', 'download_path',
    'stream_url_full', 'stream_url', 'direct_url', 'url'
  ]

  const seen = new Set()
  const queue = [data]
  const objects = []
  while (queue.length) {
    const value = queue.shift()
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    objects.push(value)
    if (Array.isArray(value)) queue.push(...value)
    else {
      // Los contenedores más comunes de DVYER deben revisarse primero.
      for (const key of ['selected', 'result', 'primary_media', 'results', 'downloads', 'media', 'download_options', 'files']) {
        if (value[key]) queue.unshift(value[key])
      }
      for (const child of Object.values(value)) if (child && typeof child === 'object') queue.push(child)
    }
  }

  for (const key of priorityKeys) {
    for (const object of objects) {
      const candidate = object?.[key]
      if (typeof candidate !== 'string' || !candidate.trim()) continue
      const url = absoluteApiUrl(candidate)
      if (url) return url
    }
  }
  return null
}

async function fetchBuffer(url, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'image/*,*/*;q=0.8', 'user-agent': `${config.botName}/${config.version}` }
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const type = response.headers.get('content-type') || ''
      if (type && !type.startsWith('image/')) throw new Error(`Contenido no válido: ${type}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 700 * attempt))
    }
  }
  throw lastError
}

function inferDocumentMime(filename = '', supplied = '') {
  if (supplied) return supplied
  const extension = path.extname(filename).toLowerCase()
  if (extension === '.apk') return 'application/vnd.android.package-archive'
  if (extension === '.xapk' || extension === '.apks' || extension === '.bin') return 'application/octet-stream'
  if (extension === '.zip') return 'application/zip'
  if (extension === '.pdf') return 'application/pdf'
  if (extension === '.txt') return 'text/plain'
  return 'application/octet-stream'
}

export async function sendRemoteMedia(sock, chat, item, { quoted, caption = '', forceDocument = false } = {}) {
  const url = pickDownloadUrl(item)
  if (!url) throw new Error('La API no entregó un enlace de descarga.')
  const filename = item.filename || item.file_name || `nero-${Date.now()}`
  const mime = item.mime_type || item.content_type || ''
  const type = String(item.type || '').toLowerCase()
  const size = Number(item.size_bytes || item.filesize_bytes || item.content_length || 0)

  if (size && size > config.maxUploadBytes) {
    await sock.sendMessage(chat, { text: `⚠️ *Archivo demasiado grande para envío automático*\n📄 ${filename}\n📦 ${formatBytes(size)}\n🔗 ${url}` }, { quoted })
    return
  }

  if (!forceDocument && (type === 'image' || mime.startsWith('image/'))) {
    await sock.sendMessage(chat, { image: { url }, caption }, { quoted })
  } else if (!forceDocument && (type === 'video' || mime.startsWith('video/'))) {
    await sock.sendMessage(chat, { video: { url }, caption, mimetype: mime || 'video/mp4', fileName: filename }, { quoted })
  } else if (!forceDocument && (type === 'audio' || mime.startsWith('audio/'))) {
    await sock.sendMessage(chat, { audio: { url }, mimetype: mime || 'audio/mp4', fileName: filename }, { quoted })
  } else if (!forceDocument && type === 'gif') {
    await sock.sendMessage(chat, { video: { url }, gifPlayback: true, caption }, { quoted })
  } else {
    await sock.sendMessage(chat, {
      document: { url },
      mimetype: inferDocumentMime(filename, mime),
      fileName: filename,
      caption
    }, { quoted })
  }
}

export async function sendImageAlbum(sock, chat, items, { quoted, caption = '' } = {}) {
  const candidates = items
    .map(item => ({ ...item, resolvedUrl: pickDownloadUrl(item) }))
    .filter(item => item.resolvedUrl)
    .slice(0, 10)

  const valid = []
  for (const item of candidates) {
    try {
      valid.push({ ...item, buffer: await fetchBuffer(item.resolvedUrl) })
    } catch (error) {
      console.warn(`Pinterest: imagen omitida (${item.resolvedUrl}):`, error?.message || error)
    }
  }

  if (!valid.length) throw new Error('Pinterest no entregó imágenes disponibles en este momento.')
  const finalCaption = caption.replace(/Resultados:\s*\d+/i, `Resultados: ${valid.length}`)

  if (valid.length === 1) {
    return sock.sendMessage(chat, { image: valid[0].buffer, caption: finalCaption }, { quoted })
  }

  try {
    const parent = await sock.sendMessage(chat, {
      album: { expectedImageCount: valid.length, expectedVideoCount: 0 }
    }, { quoted })

    for (let index = 0; index < valid.length; index += 1) {
      await sock.sendMessage(chat, {
        image: valid[index].buffer,
        caption: index === 0 ? finalCaption : undefined,
        albumParentKey: parent.key
      })
    }
    return parent
  } catch (error) {
    console.warn('El cliente no aceptó el álbum; usando envío consecutivo:', error?.message || error)
    for (let index = 0; index < valid.length; index += 1) {
      await sock.sendMessage(chat, {
        image: valid[index].buffer,
        caption: index === 0 ? finalCaption : undefined
      }, { quoted: index === 0 ? quoted : undefined })
    }
  }
}

