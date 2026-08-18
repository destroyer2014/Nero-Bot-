// ═══════════════════════════════════════════
//   NERO BOT — src/commands/reactions.js
//   Sistema de reacciones con GIF (portado de Yuta Bot)
// ═══════════════════════════════════════════

import { exec } from 'node:child_process'
import { writeFile, unlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import config from '../../config.js'
import { getNeroTempRoot } from '../lib/diskGuard.js'

const execAsync = promisify(exec)

// ── Lista de reacciones: alias, texto, si requiere mención, y el
// endpoint real de nekos.best (https://nekos.best/api/v2/<api>) ──
const reactions = [
  { name: 'hug', aliases: ['abrazo', 'abrazar'], label: 'Abrazar a alguien', action: 'abrazó a', target: true, api: 'hug' },
  { name: 'kiss', aliases: ['beso', 'besar'], label: 'Besar a alguien', action: 'besó a', target: true, api: 'kiss' },
  { name: 'pat', aliases: ['acariciar', 'palmadita'], label: 'Acariciar a alguien', action: 'acarició a', target: true, api: 'pat' },
  { name: 'slap', aliases: ['bofetada', 'cachetada'], label: 'Dar una bofetada', action: 'le dio una bofetada a', target: true, api: 'slap' },
  { name: 'punch', aliases: ['golpear', 'puñetazo'], label: 'Dar un puñetazo', action: 'golpeó a', target: true, api: 'punch' },
  { name: 'kick', aliases: ['patear', 'patada', 'patea', 'pateae'], label: 'Dar una patada', action: 'pateó a', target: true, api: 'kick' },
  { name: 'bite', aliases: ['morder'], label: 'Morder a alguien', action: 'mordió a', target: true, api: 'bite' },
  { name: 'bonk', aliases: ['mazazo'], label: 'Dar un bonk', action: 'le dio un bonk a', target: true, api: 'bonk' },
  { name: 'bully', aliases: ['molestar'], label: 'Molestar a alguien', action: 'molestó a', target: true, api: 'baka' },
  { name: 'highfive', aliases: ['chocalas', 'chocar'], label: 'Chocar los cinco', action: 'chocó los cinco con', target: true, api: 'highfive' },
  { name: 'handhold', aliases: ['tomarmano'], label: 'Tomar de la mano', action: 'tomó de la mano a', target: true, api: 'handhold' },
  { name: 'cuddle', aliases: ['acurrucar'], label: 'Acurrucarse con alguien', action: 'se acurrucó con', target: true, api: 'cuddle' },
  { name: 'wave', aliases: ['saludar'], label: 'Saludar a alguien', action: 'saludó a', target: true, api: 'wave' },
  { name: 'kill', aliases: ['matar'], label: 'Derrotar de forma ficticia', action: 'derrotó de forma ficticia a', target: true, api: 'bonk' },
  { name: 'cry', aliases: ['llorar', 'llora'], label: 'Llorar', action: 'está llorando', target: false, api: 'cry' },
  { name: 'laugh', aliases: ['reir', 'risa'], label: 'Reír', action: 'se está riendo', target: false, api: 'laugh' },
  { name: 'blush', aliases: ['sonrojar'], label: 'Sonrojarse', action: 'se sonrojó', target: false, api: 'blush' },
  { name: 'shy', aliases: ['timido', 'timida'], label: 'Sentir timidez', action: 'siente mucha timidez', target: false, api: 'blush' },
  { name: 'sleep', aliases: ['dormir', 'duerme'], label: 'Dormir', action: 'se quedó dormido/a', target: false, api: 'sleep' },
  { name: 'dance', aliases: ['bailar', 'baila'], label: 'Bailar', action: 'está bailando', target: false, api: 'dance' },
  { name: 'smile', aliases: ['sonreir', 'sonrie'], label: 'Sonreír', action: 'está sonriendo', target: false, api: 'smile' },
  { name: 'happy', aliases: ['feliz'], label: 'Estar feliz', action: 'está muy feliz', target: false, api: 'happy' },
  { name: 'sad', aliases: ['triste'], label: 'Estar triste', action: 'está triste', target: false, api: 'cry' },
  { name: 'angry', aliases: ['enojado', 'enojada'], label: 'Enojarse', action: 'está muy enojado/a', target: false, api: 'angry' }
]

// ── Descarga la URL del gif real desde nekos.best ──
async function fetchGifUrl(api) {
  try {
    const res = await fetch(`https://nekos.best/api/v2/${api}`, { headers: { 'user-agent': `${config.botName}/${config.version}` } })
    if (res.ok) {
      const json = await res.json()
      const url = json?.results?.[0]?.url
      if (url) return url
      console.error('[REACCIONES] nekos.best sin resultados para', api, json)
    } else {
      console.error('[REACCIONES] nekos.best respondió', res.status, 'para', api)
    }
  } catch (error) {
    console.error('[REACCIONES] Error consultando nekos.best:', api, error?.message || error)
  }
  // fallback genérico si el endpoint específico falla
  try {
    const res = await fetch('https://nekos.best/api/v2/pat', { headers: { 'user-agent': `${config.botName}/${config.version}` } })
    const json = await res.json()
    return json?.results?.[0]?.url || null
  } catch (error) {
    console.error('[REACCIONES] Error en fallback de nekos.best:', error?.message || error)
  }
  return null
}

// ── Convierte el GIF/WEBP a MP4 (o lo devuelve directo si ya es mp4) ──
async function gifToMp4Buffer(gifUrl) {
  const tmp = await getNeroTempRoot()
  const ts = Date.now()
  const mp4Path = join(tmp, `nero_reac_${ts}.mp4`)
  let inPath = null
  try {
    const res = await fetch(gifUrl, { headers: { 'user-agent': `${config.botName}/${config.version}` } })
    if (!res.ok) { console.error('[REACCIONES] No se pudo descargar el gif, HTTP', res.status, gifUrl); return null }
    const contentType = res.headers.get('content-type') || ''
    const buf = Buffer.from(await res.arrayBuffer())

    if (contentType.includes('video/mp4') || gifUrl.endsWith('.mp4')) return buf

    const isWebp = buf[0] === 0x52 && buf[1] === 0x49 // RIFF
    const isGif = buf[0] === 0x47 && buf[1] === 0x49 // GIF
    if (!isWebp && !isGif) return buf

    const ext = isWebp ? 'webp' : 'gif'
    inPath = join(tmp, `nero_reac_${ts}.${ext}`)
    await writeFile(inPath, buf)

    // -an quita audio (WhatsApp a veces se queda "cargando" para siempre
    // con mp4 que traen pistas de audio vacías/corruptas), perfil baseline
    // + level 3.0 es lo más compatible con el reproductor de WhatsApp.
    const cmd = `ffmpeg -i "${inPath}" -an -movflags faststart -pix_fmt yuv420p -profile:v baseline -level 3.0 -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" "${mp4Path}" -y`
    try {
      await execAsync(cmd)
    } catch (ffmpegError) {
      console.error('[REACCIONES] ffmpeg falló (¿está instalado y en el PATH del proceso PM2?):', ffmpegError?.stderr || ffmpegError?.message || ffmpegError)
      return null
    }
    const mp4Buf = await readFile(mp4Path)
    return mp4Buf
  } catch (error) {
    console.error('[REACCIONES] Error convirtiendo gif a mp4:', error?.message || error)
    return null
  } finally {
    if (inPath) unlink(inPath).catch(() => {})
    unlink(mp4Path).catch(() => {})
  }
}

function contextInfo(msg) {
  const m = msg?.message || {}
  return m.extendedTextMessage?.contextInfo || m.imageMessage?.contextInfo || m.videoMessage?.contextInfo || m.documentMessage?.contextInfo || {}
}
function mentionName(jid = '') { return `@${String(jid).split('@')[0].split(':')[0]}` }
function typedTarget(args = []) { const m = args.join(' ').match(/@(\d{7,20})/); return m ? `${m[1]}@s.whatsapp.net` : '' }

function makeReaction(def) {
  return {
    name: def.name,
    aliases: def.aliases,
    description: def.label,
    async execute(ctx) {
      const ci = contextInfo(ctx.msg)
      const target = ci?.mentionedJid?.[0] || ci?.participant || typedTarget(ctx.args)
      if (def.target && !target) {
        await ctx.sock.sendMessage(ctx.chat, { text: `❌ Debes mencionar a una persona o responder a su mensaje.\n\nEjemplo: *${config.prefix}${def.name} @usuario*` }, { quoted: ctx.msg })
        return
      }

      const actor = mentionName(ctx.sender)
      const caption = def.target
        ? `🎭 *${actor} ${def.action} ${mentionName(target)}.*\n> ✐ ${def.label}.`
        : `🎭 *${actor} ${def.action}.*\n> ✐ ${def.label}.`
      const mentions = def.target ? [ctx.sender, target] : [ctx.sender]

      try {
        const gifUrl = await fetchGifUrl(def.api)
        if (gifUrl) {
          const mp4Buffer = await gifToMp4Buffer(gifUrl)
          if (mp4Buffer) {
            await ctx.sock.sendMessage(ctx.chat, { video: mp4Buffer, gifPlayback: true, mimetype: 'video/mp4', caption, mentions }, { quoted: ctx.msg })
            return
          }
          // ffmpeg falló o no está disponible: intentamos mandar el gif/webp
          // original tal cual, mejor que quedarnos solo con el texto.
          try {
            const res = await fetch(gifUrl, { headers: { 'user-agent': `${config.botName}/${config.version}` } })
            if (res.ok) {
              const raw = Buffer.from(await res.arrayBuffer())
              await ctx.sock.sendMessage(ctx.chat, { image: raw, caption, mentions }, { quoted: ctx.msg })
              return
            }
          } catch (rawError) {
            console.error('[REACCIONES] Falló también el envío del gif crudo:', def.name, rawError?.message || rawError)
          }
        }
      } catch (error) {
        console.error('[REACCIONES] Falló el envío del gif, usando fallback de texto:', def.name, error?.message || error)
      }

      // Fallback a texto si la API o ffmpeg fallan
      await ctx.sock.sendMessage(ctx.chat, { text: caption, mentions }, { quoted: ctx.msg })
    }
  }
}

export const reactionsMenu = {
  name: 'reacciones',
  aliases: ['reactions', 'acciones'],
  description: 'Muestra todas las reacciones disponibles.',
  async execute(ctx) {
    const body = ['✦════ < 🎭 REACCIONES > ════⚝', '', ...reactions.flatMap(r => [`✦ *${config.prefix}${r.name}${r.target ? ' @usuario' : ''}*`, `> ✐ ${r.label}.`, ''])].join('\n')
    await ctx.sock.sendMessage(ctx.chat, { text: body }, { quoted: ctx.msg })
  }
}

export const reactionCommands = [reactionsMenu, ...reactions.map(makeReaction)]
