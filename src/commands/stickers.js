import { downloadContentFromMessage, jidNormalizedUser } from '@itsliaaa/baileys'
import sharp from 'sharp'
import Webpmux from 'node-webpmux'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import config from '../../config.js'
import {
  diskSpaceUserMessage,
  ensureDiskSpace,
  isDiskSpaceError,
  recoverDiskSpace
} from '../lib/diskGuard.js'
import { getStickerMeta, setStickerMeta, delStickerMeta } from '../lib/stickerMeta.js'

const q = ctx => ctx.args.join(' ').trim()
const TMP_DIR = path.resolve('tmp', 'stickers')
fs.mkdirSync(TMP_DIR, { recursive: true })

const FONT_CANDIDATES = [
  path.resolve('assets/fonts/BebasNeue-Bold.ttf'),
  path.resolve('assets/fonts/Poppins-Bold.ttf'),
  path.resolve('assets/fonts/Arial-Bold.ttf'),
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
  '/usr/share/fonts/opentype/noto/NotoSans-Bold.ttf'
]

function tmpFile(ext) {
  return path.join(TMP_DIR, `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`)
}

function cleanup(...files) {
  for (const file of files) {
    try { if (file && fs.existsSync(file)) fs.unlinkSync(file) } catch {}
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-y', ...args])
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', error => {
      if (error?.code === 'ENOENT') reject(new Error('FFmpeg no está instalado en el VPS.'))
      else reject(error)
    })
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg terminó con código ${code}: ${stderr.slice(-350)}`))
    })
  })
}

function findFont() {
  return FONT_CANDIDATES.find(file => fs.existsSync(file)) || null
}

function contextInfo(msg) {
  const m = msg?.message || {}
  return m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    m.audioMessage?.contextInfo ||
    m.stickerMessage?.contextInfo ||
    {}
}

function getQuoted(msg) {
  const c = contextInfo(msg)
  if (!c?.quotedMessage) return null
  return {
    message: c.quotedMessage,
    sender: c.participant || c.remoteJid || ''
  }
}

function extractText(message = {}) {
  return message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    ''
}

function extractMedia(msg) {
  const direct = msg?.message || {}
  if (direct.imageMessage) return { type: 'image', message: direct.imageMessage }
  if (direct.videoMessage) return { type: 'video', message: direct.videoMessage }
  if (direct.stickerMessage) return { type: 'sticker', message: direct.stickerMessage }

  const quoted = getQuoted(msg)
  if (!quoted) return null
  if (quoted.message.imageMessage) return { type: 'image', message: quoted.message.imageMessage, sender: quoted.sender }
  if (quoted.message.videoMessage) return { type: 'video', message: quoted.message.videoMessage, sender: quoted.sender }
  if (quoted.message.stickerMessage) return { type: 'sticker', message: quoted.message.stickerMessage, sender: quoted.sender }
  return null
}

async function downloadMedia(type, message) {
  const stream = await downloadContentFromMessage(message, type)
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function react(ctx, emoji) {
  await ctx.sock.sendMessage(ctx.chat, { react: { text: emoji, key: ctx.msg.key } }).catch(() => {})
}

function wrap(name, aliases, fn) {
  return {
    name,
    aliases,
    async execute(ctx) {
      try {
        await ensureDiskSpace(
          32 * 1024 * 1024,
          { label: 'procesar el sticker' }
        )
        await fn(ctx)
      } catch (error) {
        await react(ctx, '❌')
        if (isDiskSpaceError(error)) {
          await recoverDiskSpace().catch(() => {})
          await ctx.sock.sendMessage(ctx.chat, {
            text: diskSpaceUserMessage()
          }, { quoted: ctx.msg })
          return
        }
        await ctx.sock.sendMessage(ctx.chat, {
          text: `❌ ${error?.message || 'No se pudo completar el comando de sticker.'}`
        }, { quoted: ctx.msg })
      }
    }
  }
}

function metaFor(sender) {
  return getStickerMeta(sender)
}

async function applyStickerMeta(buffer, packname, author) {
  const image = new Webpmux.Image()
  await image.load(buffer)
  const json = {
    'sticker-pack-id': `nero-${Date.now()}`,
    'sticker-pack-name': packname || 'Nero Bot',
    'sticker-pack-publisher': author || 'ArcadiaCorps',
    emojis: ['✨']
  }
  const exif = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00
  ])
  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8')
  exif.writeUIntLE(jsonBuffer.length, 14, 4)
  image.exif = Buffer.concat([exif, jsonBuffer])
  return image.save(null)
}

async function staticStickerFromImage(buffer, sender) {
  const webp = await sharp(buffer)
    .rotate()
    .resize(512, 512, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: false
    })
    .webp({ quality: 90, alphaQuality: 100 })
    .toBuffer()
  const { packname, author } = metaFor(sender)
  return applyStickerMeta(webp, packname, author)
}

const STICKER_MAX_BYTES = 900 * 1024
const VIDEO_PRESETS = [
  { seconds: 6, fps: 15, quality: 70 },
  { seconds: 6, fps: 12, quality: 55 },
  { seconds: 5, fps: 10, quality: 45 },
  { seconds: 4, fps: 8, quality: 35 }
]

async function encodeVideoSticker(input, output) {
  let lastError
  for (const preset of VIDEO_PRESETS) {
    try {
      await runFfmpeg([
        '-i', input,
        '-vf', `scale=512:512:force_original_aspect_ratio=decrease,format=rgba,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=${preset.fps}`,
        '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(preset.quality),
        '-loop', '0', '-preset', 'default', '-an', '-vsync', '0',
        '-t', String(preset.seconds), output
      ])
      const size = fs.statSync(output).size
      if (size <= STICKER_MAX_BYTES) return
      lastError = new Error(`El sticker animado quedó demasiado pesado (${Math.ceil(size / 1024)} KB).`)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error('No se pudo generar el sticker animado.')
}

function escapeXml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function wrapText(text, maxChars = 15, maxLines = 8) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean)
  const lines = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      lines.push(current)
      current = word
    } else current = next
    if (lines.length >= maxLines - 1) break
  }
  if (current && lines.length < maxLines) lines.push(current)
  if (words.join(' ').length > lines.join(' ').length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, Math.max(1, maxChars - 1))}…`
  }
  return lines
}

function fontSizeFor(text) {
  const length = String(text || '').length
  if (length <= 18) return 82
  if (length <= 40) return 66
  if (length <= 75) return 52
  if (length <= 120) return 42
  return 34
}

async function renderTextSticker(text, { mode = 'plain' } = {}) {
  const clean = String(text || '').trim().slice(0, 220)
  if (!clean) throw new Error('Debes escribir un texto.')
  const fontSize = fontSizeFor(clean)
  const maxChars = Math.max(8, Math.floor(760 / fontSize))
  const lines = wrapText(clean, maxChars, 8)
  const lineHeight = Math.round(fontSize * 1.12)
  const totalHeight = lineHeight * lines.length
  const startY = Math.max(fontSize, Math.round((512 - totalHeight) / 2) + fontSize)

  let background = '#ffffff'
  let textColor = '#111111'
  let stroke = 'none'
  let strokeWidth = 0
  if (mode === 'nero') {
    background = '#111018'
    textColor = '#ffffff'
    stroke = '#000000'
    strokeWidth = 2
  }

  const tspans = lines.map((line, index) =>
    `<tspan x="256" y="${startY + index * lineHeight}">${escapeXml(line)}</tspan>`
  ).join('')

  const svg = Buffer.from(`
    <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" rx="36" fill="${background}"/>
      <text x="256" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif"
        font-weight="700" font-size="${fontSize}" fill="${textColor}"
        stroke="${stroke}" stroke-width="${strokeWidth}" paint-order="stroke">${tspans}</text>
    </svg>
  `)
  return sharp(svg).webp({ quality: 92 }).toBuffer()
}

async function renderQuoteSticker(name, text) {
  const cleanName = String(name || 'Usuario').slice(0, 40)
  const cleanText = String(text || '').trim().slice(0, 500)
  const lines = wrapText(cleanText, 27, 12)
  const tspans = lines.map((line, index) =>
    `<tspan x="58" y="${170 + index * 34}">${escapeXml(line)}</tspan>`
  ).join('')
  const svg = Buffer.from(`
    <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" rx="42" fill="#121218"/>
      <circle cx="78" cy="84" r="34" fill="#302f3a"/>
      <text x="128" y="76" font-family="DejaVu Sans, Arial, sans-serif" font-size="27" font-weight="700" fill="#ffffff">${escapeXml(cleanName)}</text>
      <text x="128" y="108" font-family="DejaVu Sans, Arial, sans-serif" font-size="18" fill="#a8a7b2">Nero Quote</text>
      <text font-family="DejaVu Sans, Arial, sans-serif" font-size="25" fill="#f5f5f7">${tspans}</text>
    </svg>
  `)
  return sharp(svg).webp({ quality: 92 }).toBuffer()
}

function targetFromMessage(ctx) {
  const c = contextInfo(ctx.msg)
  const mentioned = c?.mentionedJid?.[0]
  if (mentioned) return mentioned
  if (c?.participant) return c.participant
  const numeric = String(ctx.args[0] || '').replace(/\D/g, '')
  if (numeric.length >= 8) return `${numeric}@s.whatsapp.net`
  return ctx.sender
}

function normalizeTarget(jid) {
  const value = String(jid || '')
  if (!value) return value
  return jidNormalizedUser(value)
}

export const sticker = wrap('sticker', ['s'], async ctx => {
  const media = extractMedia(ctx.msg)
  if (!media || media.type === 'sticker') {
    throw new Error(`Responde o envía una imagen o video corto con ${config.prefix}sticker.`)
  }
  await react(ctx, '⏳')
  if (media.type === 'image') {
    const buffer = await downloadMedia('image', media.message)
    const finalBuffer = await staticStickerFromImage(buffer, ctx.sender)
    await ctx.sock.sendMessage(ctx.chat, { sticker: finalBuffer }, { quoted: ctx.msg })
    await react(ctx, '✅')
    return
  }

  const seconds = Number(media.message?.seconds || 0)
  if (seconds > 12) throw new Error('El video es muy largo. Máximo 12 segundos para stickers.')
  const input = tmpFile('mp4')
  const output = tmpFile('webp')
  try {
    fs.writeFileSync(input, await downloadMedia('video', media.message))
    await encodeVideoSticker(input, output)
    const { packname, author } = metaFor(ctx.sender)
    const finalBuffer = await applyStickerMeta(fs.readFileSync(output), packname, author)
    await ctx.sock.sendMessage(ctx.chat, { sticker: finalBuffer }, { quoted: ctx.msg })
    await react(ctx, '✅')
  } finally {
    cleanup(input, output)
  }
})

export const setpack = wrap('setpack', ['setpackname'], async ctx => {
  if (!ctx.isOwner && !ctx.isSubOwner) throw new Error('Solo Owner o SubOwner puede cambiar el paquete global.')
  const value = q(ctx)
  if (!value) throw new Error('Uso: .setpack <nombre del paquete>')
  const meta = setStickerMeta({ packname: value })
  await ctx.sock.sendMessage(ctx.chat, {
    text: `✅ Packname global actualizado.\nPaquete: *${meta.packname}*\nAutor: *${meta.author}*`
  }, { quoted: ctx.msg })
})

export const setauthor = wrap('setauthor', ['setstickerauthor'], async ctx => {
  if (!ctx.isOwner && !ctx.isSubOwner) throw new Error('Solo Owner o SubOwner puede cambiar el autor global.')
  const value = q(ctx)
  if (!value) throw new Error('Uso: .setauthor <autor>')
  const meta = setStickerMeta({ author: value })
  await ctx.sock.sendMessage(ctx.chat, {
    text: `✅ Autor global actualizado.\nPaquete: *${meta.packname}*\nAutor: *${meta.author}*`
  }, { quoted: ctx.msg })
})

export const setmeta = wrap('setmeta', [], async ctx => {
  const text = q(ctx)
  if (!text.includes('|')) throw new Error('Uso: .setmeta Nombre del Pack|Tu nombre')
  const [packname, author] = text.split('|').map(value => value.trim())
  if (!packname || !author) throw new Error('Debes indicar pack y autor separados por |.')
  const meta = setStickerMeta({ packname, author }, ctx.sender)
  await ctx.sock.sendMessage(ctx.chat, {
    text: `✅ Meta personal guardada.\n📦 Pack: *${meta.packname}*\n✍️ Autor: *${meta.author}*`
  }, { quoted: ctx.msg })
})

export const delmeta = wrap('delmeta', [], async ctx => {
  const removed = delStickerMeta(ctx.sender)
  await ctx.sock.sendMessage(ctx.chat, {
    text: removed
      ? '🗑️ Meta personal eliminada. Se usarán los valores globales de Nero.'
      : 'No tenías una meta personal guardada.'
  }, { quoted: ctx.msg })
})

export const stickermeta = wrap('stickermeta', ['packinfo'], async ctx => {
  const global = getStickerMeta()
  const effective = getStickerMeta(ctx.sender)
  await ctx.sock.sendMessage(ctx.chat, {
    text: [
      '📦 *Metadatos de stickers*',
      `Tu paquete: ${effective.packname}`,
      `Tu autor: ${effective.author}`,
      '',
      `Global: ${global.packname} • ${global.author}`,
      '',
      'Personal: .setmeta Pack|Autor / .delmeta',
      'Global (Owner/SubOwner): .setpack / .setauthor'
    ].join('\n')
  }, { quoted: ctx.msg })
})

export const textsticker = wrap('textosticker', ['textsticker', 'tstk'], async ctx => {
  const text = q(ctx)
  if (!text) throw new Error('Uso: .textosticker <texto>')
  await react(ctx, '⏳')
  const webp = await renderTextSticker(text, { mode: 'nero' })
  const { packname, author } = metaFor(ctx.sender)
  const finalBuffer = await applyStickerMeta(webp, packname, author)
  await ctx.sock.sendMessage(ctx.chat, { sticker: finalBuffer }, { quoted: ctx.msg })
  await react(ctx, '✅')
})

export const pfp = wrap('pfp', ['getpic'], async ctx => {
  const target = normalizeTarget(targetFromMessage(ctx))
  try {
    const url = await ctx.sock.profilePictureUrl(target, 'image')
    await ctx.sock.sendMessage(ctx.chat, { image: { url }, caption: '🖼️ Foto de perfil' }, { quoted: ctx.msg })
  } catch {
    throw new Error('No pude obtener la foto de perfil; puede ser privada o no existir.')
  }
})

export const qc = wrap('qc', [], async ctx => {
  const quoted = getQuoted(ctx.msg)
  if (!quoted) throw new Error('Responde a un mensaje de texto con .qc.')
  const quotedText = extractText(quoted.message)
  if (!quotedText) throw new Error('El mensaje citado no contiene texto.')
  await react(ctx, '⏳')
  const name = q(ctx) || String(quoted.sender || 'Usuario').split('@')[0]
  const webp = await renderQuoteSticker(name, quotedText)
  const { packname, author } = metaFor(ctx.sender)
  const finalBuffer = await applyStickerMeta(webp, packname, author)
  await ctx.sock.sendMessage(ctx.chat, { sticker: finalBuffer }, { quoted: ctx.msg })
  await react(ctx, '✅')
})

export const toimg = wrap('toimg', ['img'], async ctx => {
  const media = extractMedia(ctx.msg)
  if (!media || media.type !== 'sticker') throw new Error('Responde a un sticker con .toimg.')
  await react(ctx, '⏳')
  const buffer = await downloadMedia('sticker', media.message)
  const png = await sharp(buffer, { animated: false }).png().toBuffer()
  await ctx.sock.sendMessage(ctx.chat, { image: png, caption: '🖼️ Sticker convertido a imagen' }, { quoted: ctx.msg })
  await react(ctx, '✅')
})

async function makeStaticTextCommand(ctx, mode = 'plain') {
  const text = q(ctx)
  if (!text) throw new Error(`Uso: .${ctx.command || 'brat'} <texto>`)
  await react(ctx, '⏳')
  const webp = await renderTextSticker(text, { mode })
  const { packname, author } = metaFor(ctx.sender)
  const finalBuffer = await applyStickerMeta(webp, packname, author)
  await ctx.sock.sendMessage(ctx.chat, { sticker: finalBuffer }, { quoted: ctx.msg })
  await react(ctx, '✅')
}

export const brat = wrap('brat', ['ttp'], async ctx => makeStaticTextCommand(ctx, 'plain'))

export const attp = wrap('attp', [], async ctx => {
  const text = q(ctx)
  if (!text) throw new Error('Uso: .attp <texto>')
  const font = findFont()
  if (!font) throw new Error('No encontré una fuente compatible para generar el sticker animado.')
  await react(ctx, '⏳')
  const textFile = tmpFile('txt')
  const output = tmpFile('webp')
  try {
    fs.writeFileSync(textFile, text.slice(0, 120), 'utf8')
    const safeFont = font.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'")
    const safeTextFile = textFile.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'")
    await runFfmpeg([
      '-f', 'lavfi', '-i', 'color=c=black:s=512x512:d=3',
      '-vf', `drawtext=fontfile='${safeFont}':textfile='${safeTextFile}':fontcolor=white:fontsize=58:x=(w-text_w)/2+8*sin(6*t):y=(h-text_h)/2+8*cos(5*t):box=1:boxcolor=black@0.30:boxborderw=14`,
      '-c:v', 'libwebp', '-lossless', '0', '-q:v', '58', '-loop', '0',
      '-preset', 'default', '-an', '-vsync', '0', '-r', '15', output
    ])
    const { packname, author } = metaFor(ctx.sender)
    const finalBuffer = await applyStickerMeta(fs.readFileSync(output), packname, author)
    await ctx.sock.sendMessage(ctx.chat, { sticker: finalBuffer }, { quoted: ctx.msg })
    await react(ctx, '✅')
  } finally {
    cleanup(textFile, output)
  }
})

export const emojimix = wrap('emojimix', [], async ctx => {
  const emojis = q(ctx).split(/\s+/).filter(Boolean)
  if (emojis.length !== 2) throw new Error('Uso: .emojimix 😀 😍')
  await react(ctx, '⏳')
  const url = `https://emojik.vercel.app/s/${encodeURIComponent(emojis[0])}_${encodeURIComponent(emojis[1])}?size=256`
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })
  if (!response.ok) throw new Error('Esa combinación de emojis no está disponible.')
  const finalBuffer = await staticStickerFromImage(Buffer.from(await response.arrayBuffer()), ctx.sender)
  await ctx.sock.sendMessage(ctx.chat, { sticker: finalBuffer }, { quoted: ctx.msg })
  await react(ctx, '✅')
})

export const wm = wrap('wm', [], async ctx => {
  const media = extractMedia(ctx.msg)
  if (!media || media.type !== 'sticker') throw new Error('Responde a un sticker con .wm Pack|Autor.')
  const text = q(ctx)
  if (!text.includes('|')) throw new Error('Uso: .wm Nombre del Pack|Autor')
  const [packname, author] = text.split('|').map(value => value.trim())
  if (!packname || !author) throw new Error('Debes indicar pack y autor separados por |.')
  await react(ctx, '⏳')
  const buffer = await downloadMedia('sticker', media.message)
  const finalBuffer = await applyStickerMeta(buffer, packname, author)
  await ctx.sock.sendMessage(ctx.chat, { sticker: finalBuffer }, { quoted: ctx.msg })
  await react(ctx, '✅')
})

export const stickerMenu = wrap('menusticker', ['menustickers'], async ctx => {
  const p = config.prefix
  const body = [
    '✦════ < 🖼️ MENÚ DE STICKERS > ════⚝',
    '',
    `✦ *${p}sticker • ${p}s*`,
    '> Crea un sticker desde imagen o video corto.',
    `✦ *${p}setmeta Pack|Autor*`,
    '> Guarda tu pack y autor personal.',
    `✦ *${p}delmeta*`,
    '> Elimina tu metadata personal.',
    `✦ *${p}pfp • ${p}getpic*`,
    '> Obtiene la foto de perfil de un usuario.',
    `✦ *${p}qc*`,
    '> Convierte un mensaje citado en sticker tipo quote.',
    `✦ *${p}toimg • ${p}img*`,
    '> Convierte un sticker en imagen.',
    `✦ *${p}brat • ${p}ttp*`,
    '> Crea un sticker estático de texto.',
    `✦ *${p}attp*`,
    '> Crea un sticker animado de texto.',
    `✦ *${p}emojimix 😀 😍*`,
    '> Mezcla dos emojis en un sticker.',
    `✦ *${p}wm Pack|Autor*`,
    '> Cambia los metadatos de un sticker existente.',
    '',
    'Nero también conserva:',
    `• ${p}textosticker <texto>`,
    `• ${p}setpack / ${p}setauthor / ${p}stickermeta`,
    `• ${p}stickersearch <búsqueda>`
  ].join('\n')
  await ctx.sock.sendMessage(ctx.chat, { text: body }, { quoted: ctx.msg })
})

export const stickerCommands = [
  sticker,
  setpack,
  setauthor,
  setmeta,
  delmeta,
  stickermeta,
  textsticker,
  pfp,
  qc,
  toimg,
  brat,
  attp,
  emojimix,
  wm,
  stickerMenu
]
