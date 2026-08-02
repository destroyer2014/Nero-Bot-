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
  const selected = data.selected || {}
  const result = data.result || {}
  const candidates = [
    selected.proxy_download_url_full,
    selected.proxy_download_url,
    data.proxy_download_url_full,
    data.proxy_download_url,
    selected.download_url_full,
    selected.download_url,
    result.download_url_full,
    result.download_url,
    data.download_url_full,
    data.download_url,
    selected.stream_url_full,
    selected.stream_url,
    data.stream_url_full,
    data.stream_url,
    selected.direct_url,
    data.direct_url,
    selected.url,
    result.url,
    data.url
  ]
  for (const candidate of candidates) {
    const url = absoluteApiUrl(candidate)
    if (url) return url
  }
  return null
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
  const valid = items.map(item => ({ ...item, resolvedUrl: pickDownloadUrl(item) })).filter(item => item.resolvedUrl).slice(0, 10)
  if (!valid.length) throw new Error('No encontré imágenes válidas para enviar.')
  if (valid.length === 1) {
    return sock.sendMessage(chat, { image: { url: valid[0].resolvedUrl }, caption }, { quoted })
  }

  try {
    const parent = await sock.sendMessage(chat, {
      album: { expectedImageCount: valid.length, expectedVideoCount: 0 }
    }, { quoted })

    for (let index = 0; index < valid.length; index += 1) {
      await sock.sendMessage(chat, {
        image: { url: valid[index].resolvedUrl },
        caption: index === 0 ? caption : undefined,
        albumParentKey: parent.key
      })
    }
    return parent
  } catch (error) {
    console.warn('El cliente no aceptó el álbum; usando envío consecutivo:', error?.message || error)
    for (let index = 0; index < valid.length; index += 1) {
      await sock.sendMessage(chat, {
        image: { url: valid[index].resolvedUrl },
        caption: index === 0 ? caption : undefined
      }, { quoted: index === 0 ? quoted : undefined })
    }
  }
}
