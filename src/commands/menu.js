import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../../config.js'
import { formatDateTime, jidToNumber } from '../lib/format.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

const section = (title, lines) => [
  `╭─❧ *${title}*`,
  ...lines.map(line => `│ ✦ ${line}`),
  '╰────────────❧'
].join('\n')

const categoryMenus = {
  descargas: () => section('DESCARGAS', [
    '.play / .ytmp3 / .ytmp4',
    '.spotify / .ytmusic',
    '.tiktok / .instagram / .facebook',
    '.pinterest / .mediafire / .mega',
    '.terabox / .apk / .apkmod',
    '.anime'
  ]),
  buscadores: () => section('BUSCADORES', [
    '.ytsearch / .play',
    '.tiktoksearch',
    '.pinterestsearch',
    '.googleimages',
    '.wikipedia',
    '.stickersearch'
  ]),
  herramientas: () => section('HERRAMIENTAS', [
    '.hd / .upscale / .restaurar',
    '.convertir / .comprimir / .removebg',
    '.textoimagen / .textogif / .textosticker',
    '.qr / .ytthumb / .ssweb',
    '.traducir / .ocr / .transcribir',
    '.shazam / .quitarvoz',
    '.checkhost / .pais / .tempmail'
  ]),
  stickers: () => section('STICKERS', [
    '.sticker / .s',
    '.stickerwm paquete|autor',
    '.renombrarsticker paquete|autor',
    '.toimg',
    '.textosticker',
    '.stickersearch'
  ]),
  administracion: () => section('ADMINISTRACIÓN', [
    '.antinsfw on/off',
    '.warns @usuario',
    '.resetwarn @usuario',
    '.cola / .cancelardescarga',
    '.limpiarcola'
  ])
}

export const command = {
  name: 'menu',
  aliases: ['help', 'comandos', 'descargas', 'buscadores', 'herramientas', 'tools', 'stickers', 'administracion'],
  async execute({ sock, msg, chat, sender, text }) {
    const invoked = text.slice(config.prefix.length).trim().split(/\s+/)[0].toLowerCase()
    if (categoryMenus[invoked]) {
      return sock.sendMessage(chat, { text: categoryMenus[invoked]() }, { quoted: msg })
    }

    const { date, time } = formatDateTime(config.timezone)
    const mention = `@${jidToNumber(sender)}`
    const body = [
      `╭─❧ *${config.botName}*`,
      `│ ✐ *Usuario ›* ${mention}`,
      `│ ✐ *Creador ›* ${config.creator}`,
      `│ ✐ *Plugins ›* ${config.plugins}`,
      `│ ✐ *Versión ›* ${config.version}`,
      `│ ✐ *Link ›* ${config.website}`,
      `│ ✐ *Fecha ›* ${date}`,
      `│ ✐ *Hora ›* ${time}`,
      '╰────────────❧',
      '',
      section('DESCARGAS', [
        '.play / .ytmp3 / .ytmp4',
        '.spotify / .ytmusic',
        '.tiktok / .instagram / .facebook',
        '.pinterest / .mediafire / .mega',
        '.terabox / .apk / .apkmod',
        '.anime'
      ]),
      '',
      section('BUSCADORES', [
        '.ytsearch / .play',
        '.tiktoksearch',
        '.pinterestsearch',
        '.googleimages',
        '.wikipedia',
        '.stickersearch'
      ]),
      '',
      section('HERRAMIENTAS', [
        '.hd / .upscale / .restaurar',
        '.convertir / .comprimir / .removebg',
        '.textoimagen / .textogif / .textosticker',
        '.qr / .ytthumb / .ssweb',
        '.traducir / .ocr / .transcribir',
        '.shazam / .quitarvoz',
        '.checkhost / .pais / .tempmail'
      ]),
      '',
      section('STICKERS', [
        '.sticker / .s',
        '.stickerwm paquete|autor',
        '.renombrarsticker paquete|autor',
        '.toimg',
        '.textosticker',
        '.stickersearch'
      ]),
      '',
      section('ADMINISTRACIÓN', [
        '.antinsfw on/off',
        '.warns @usuario',
        '.resetwarn @usuario',
        '.cola / .cancelardescarga',
        '.limpiarcola'
      ])
    ].join('\n')

    try {
      const video = await fs.readFile(path.resolve(projectRoot, config.menuVideo))
      await sock.sendMessage(chat, { video, gifPlayback: true, caption: body, mentions: [sender] }, { quoted: msg })
    } catch {
      await sock.sendMessage(chat, { text: body, mentions: [sender] }, { quoted: msg })
    }
  }
}
