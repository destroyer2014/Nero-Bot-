import sharp from 'sharp'
import Webpmux from 'node-webpmux'
import config from '../../config.js'
import { apiGet } from '../lib/api.js'
import { getStickerMeta, setStickerMeta } from '../lib/stickerMeta.js'

const q = ctx => ctx.args.join(' ').trim()

function exifBuffer(packname, author) {
  const json = Buffer.from(JSON.stringify({
    'sticker-pack-id': 'nero-bot',
    'sticker-pack-name': packname,
    'sticker-pack-publisher': author,
    emojis: ['🖤']
  }))
  const header = Buffer.from([0x49,0x49,0x2A,0x00,0x08,0x00,0x00,0x00,0x01,0x00,0x41,0x57,0x07,0x00])
  const length = Buffer.alloc(4)
  length.writeUInt32LE(json.length, 0)
  return Buffer.concat([header, length, Buffer.from([0x00,0x00,0x00,0x00]), json])
}

async function makeSticker(buffer) {
  const webp = await sharp(buffer).rotate().resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer()
  const image = new Webpmux.Image()
  await image.load(webp)
  const meta = getStickerMeta()
  image.exif = exifBuffer(meta.packname, meta.author)
  return image.save(null)
}

export const setpack = {
  name: 'setpack', aliases: ['setpackname'],
  async execute(ctx) {
    if (!ctx.isOwner && !ctx.isSubOwner) throw new Error('Solo Owner o SubOwner puede cambiar el paquete.')
    const value = q(ctx); if (!value) throw new Error('Uso: .setpack <nombre del paquete>')
    const meta = setStickerMeta({ packname: value })
    await ctx.sock.sendMessage(ctx.chat, { text: `✅ Packname actualizado.\nPaquete: *${meta.packname}*\nAutor: *${meta.author}*` }, { quoted: ctx.msg })
  }
}

export const setauthor = {
  name: 'setauthor', aliases: ['setstickerauthor'],
  async execute(ctx) {
    if (!ctx.isOwner && !ctx.isSubOwner) throw new Error('Solo Owner o SubOwner puede cambiar el autor.')
    const value = q(ctx); if (!value) throw new Error('Uso: .setauthor <autor>')
    const meta = setStickerMeta({ author: value })
    await ctx.sock.sendMessage(ctx.chat, { text: `✅ Autor actualizado.\nPaquete: *${meta.packname}*\nAutor: *${meta.author}*` }, { quoted: ctx.msg })
  }
}

export const stickermeta = {
  name: 'stickermeta', aliases: ['packinfo'],
  async execute(ctx) {
    const meta = getStickerMeta()
    await ctx.sock.sendMessage(ctx.chat, { text: `📦 *Metadatos de stickers*\nPaquete: ${meta.packname}\nAutor: ${meta.author}\n\nCambiar: .setpack / .setauthor` }, { quoted: ctx.msg })
  }
}

export const textsticker = {
  name: 'textosticker', aliases: ['textsticker','tstk'],
  async execute(ctx) {
    const text = q(ctx); if (!text) throw new Error('Uso: .textosticker <texto>')
    const d = await apiGet('/tools/text-sticker', { mode: 'link', text, style: 'neon', size: 512, format: 'png' })
    const url = d.download_url_full || d.download_url || d.stream_url_full || d.url
    if (!url) throw new Error('La API no entregó la imagen.')
    const r = await fetch(url)
    if (!r.ok) throw new Error(`No se pudo descargar el sticker (HTTP ${r.status}).`)
    const sticker = await makeSticker(Buffer.from(await r.arrayBuffer()))
    await ctx.sock.sendMessage(ctx.chat, { sticker }, { quoted: ctx.msg })
  }
}

export const stickerCommands = [setpack, setauthor, stickermeta, textsticker]
