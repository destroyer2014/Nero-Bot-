import { downloadMediaMessage } from '@itsliaaa/baileys'
import { requireEvoGbApiKey } from '../lib/api.js'
import { sendInteractive, singleSelect } from '../lib/interactive.js'
import { saveSelection, getSelection } from '../lib/selectionCache.js'
import config from '../../config.js'

function quoted(msg) {
  const c = msg.message?.extendedTextMessage?.contextInfo || msg.message?.imageMessage?.contextInfo || {}
  return c?.quotedMessage ? { key: { remoteJid: msg.key.remoteJid, id: c.stanzaId, participant: c.participant }, message: c.quotedMessage } : msg
}
async function media(ctx) {
  try { return await downloadMediaMessage(quoted(ctx.msg), 'buffer', {}, { logger: console, reuploadRequest: ctx.sock.updateMediaMessage }) }
  catch { return null }
}
async function multipart(endpoint, buffer, params = {}) {
  const key = requireEvoGbApiKey(); const base = process.env.EVOGB_API_BASE_URL || 'https://api.evogb.org'
  const url = new URL(endpoint, base); url.searchParams.set('key', key)
  for (const [k,v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  const form = new FormData(); form.append('file', new Blob([buffer]), 'imagen.jpg')
  const r = await fetch(url, { method: 'POST', body: form })
  const type = (r.headers.get('content-type') || '').toLowerCase()
  if (type.startsWith('image/') || type.startsWith('video/')) return { binary: Buffer.from(await r.arrayBuffer()), type }
  const d = await r.json().catch(() => ({})); if (!r.ok || d.status === false) throw new Error(d.message || `HTTP ${r.status}`)
  return d
}

export const animatedgif = {
  name: 'animatedgif', aliases: ['triggered','blinkgif'],
  async execute(ctx) {
    const b = await media(ctx); if (!b) throw new Error('Responde a una imagen con .animatedgif triggered o .animatedgif blink')
    const gifType = (ctx.args[0] || (ctx.text.includes('blinkgif') ? 'blink' : 'triggered')).toLowerCase()
    if (!['triggered','blink'].includes(gifType)) throw new Error('Tipos: triggered o blink')
    const d = await multipart('/generate/animated-gif', b, { method: 'local', gifType, timeout: 15 })
    if (d.binary) return ctx.sock.sendMessage(ctx.chat, { video: d.binary, gifPlayback: true, mimetype: 'video/mp4' }, { quoted: ctx.msg })
    const url = d.result || d.url || d.download_url
    if (!url) throw new Error('La API no entregó el GIF.')
    await ctx.sock.sendMessage(ctx.chat, { video: { url }, gifPlayback: true }, { quoted: ctx.msg })
  }
}

const filters = [
  ['blur','Desenfoque'],['pixelate','Pixelado'],['wave','Ondas'],['glitch','Glitch digital'],
  ['sticker','Borde blanco'],['gay','Bandera arcoíris'],['grayscale','Escala de grises'],
  ['invert','Invertir colores'],['sepia','Sepia']
]

export const filtro = {
  name: 'filtro', aliases: ['filter'],
  async execute(ctx) {
    const b = await media(ctx); if (!b) throw new Error('Responde a una imagen con .filtro')
    const selected = (ctx.args[0] || '').toLowerCase()
    if (!selected) {
      const token = saveSelection('filter-image', { buffer: b.toString('base64') })
      const rows = filters.map(([id,label]) => ({ header: 'Filtro', title: label, description: `Aplicar ${label}`, id: `${config.prefix}filtropick ${token} ${id}` }))
      return sendInteractive(ctx.sock, ctx.chat, { title: 'Filtros de imagen', body: 'Selecciona el efecto que deseas aplicar.', buttons: [singleSelect('Elegir filtro', [{ title: 'Filtros', rows }])] }, ctx.msg)
    }
    const d = await multipart('/generate/filters', b, { method: 'local', filterType: selected, level: Number(ctx.args[1]) || 10 })
    if (d.binary) return ctx.sock.sendMessage(ctx.chat, { image: d.binary, caption: `✨ Filtro: ${selected}` }, { quoted: ctx.msg })
    const url = d.result || d.url || d.download_url; if (!url) throw new Error('La API no entregó la imagen.')
    await ctx.sock.sendMessage(ctx.chat, { image: { url }, caption: `✨ Filtro: ${selected}` }, { quoted: ctx.msg })
  }
}

export const filtropick = {
  name: 'filtropick', aliases: [],
  async execute(ctx) {
    const [token, filterType] = ctx.args; const data = getSelection(token, 'filter-image')
    if (!data) throw new Error('La selección venció. Responde otra vez con .filtro')
    const b = Buffer.from(data.buffer, 'base64')
    const d = await multipart('/generate/filters', b, { method: 'local', filterType, level: 10 })
    if (d.binary) return ctx.sock.sendMessage(ctx.chat, { image: d.binary, caption: `✨ Filtro: ${filterType}` }, { quoted: ctx.msg })
    const url = d.result || d.url || d.download_url; if (!url) throw new Error('La API no entregó la imagen.')
    await ctx.sock.sendMessage(ctx.chat, { image: { url }, caption: `✨ Filtro: ${filterType}` }, { quoted: ctx.msg })
  }
}

export const generatorCommands = [animatedgif, filtro, filtropick]
