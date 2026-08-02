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

export function pickDownloadUrl(data = {}) {
  return data.download_url_full || data.proxy_download_url_full || data.download_url || data.stream_url_full || data.stream_url || data.url || data.direct_url
}

export async function sendRemoteMedia(sock, chat, item, { quoted, caption = '', forceDocument = false } = {}) {
  const url = pickDownloadUrl(item)
  if (!url) throw new Error('La API no entregó un enlace de descarga.')
  const filename = item.filename || item.file_name || `nero-${Date.now()}`
  const mime = item.mime_type || item.content_type || ''
  const type = String(item.type || '').toLowerCase()
  const size = Number(item.size_bytes || item.filesize_bytes || item.content_length || 0)

  if (size && size > config.maxUploadBytes) {
    await sock.sendMessage(chat, { text: `⚠️ *Archivo demasiado grande para envío automático*
📄 ${filename}
📦 ${formatBytes(size)}
🔗 ${url}` }, { quoted })
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
    await sock.sendMessage(chat, { document: { url }, mimetype: mime || 'application/octet-stream', fileName: filename, caption }, { quoted })
  }
}
