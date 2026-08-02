import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../../config.js'
import { formatDateTime, jidToNumber } from '../lib/format.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

const item = (commands, description) => [
  `│ ✦ *${commands}*`,
  `│   > ✐ ${description}`
]

const section = (title, entries) => [
  `╭─❧ *${title}*`,
  ...entries.flatMap(([commands, description]) => item(commands, description)),
  '╰────────────❧'
].join('\n')

const entries = {
  descargas: [
    ['.play / .ytmp3 / .ytmp4', 'Busca y descarga audio o video de YouTube.'],
    ['.spotify / .ytmusic', 'Busca canciones y permite descargar el resultado elegido.'],
    ['.tiktok / .instagram / .facebook', 'Descarga videos, fotos o publicaciones usando un enlace.'],
    ['.pinterest / .mediafire / .mega', 'Descarga imágenes y archivos desde su enlace.'],
    ['.terabox / .apk / .apkmod', 'Obtiene archivos, aplicaciones y versiones modificadas.'],
    ['.anime', 'Busca un anime y descarga el episodio seleccionado.']
  ],
  buscadores: [
    ['.ytsearch / .play', 'Busca videos o canciones por nombre en YouTube.'],
    ['.tiktoksearch', 'Busca videos de TikTok y los muestra en carrusel.'],
    ['.pinterestsearch', 'Busca imágenes de Pinterest y las envía juntas.'],
    ['.googleimages', 'Busca imágenes en Google por nombre.'],
    ['.wikipedia', 'Consulta información y artículos de Wikipedia.'],
    ['.stickersearch', 'Busca paquetes públicos disponibles en Sticker.ly.']
  ],
  herramientas: [
    ['.hd / .upscale / .restaurar', 'Mejora, amplía o restaura la calidad de una imagen.'],
    ['.convertir / .comprimir / .removebg', 'Convierte, reduce el peso o elimina el fondo de una imagen.'],
    ['.textoimagen / .textogif / .textosticker', 'Convierte un texto en imagen, GIF o sticker.'],
    ['.qr / .ytthumb / .ssweb', 'Genera QR, obtiene miniaturas o captura una página web.'],
    ['.traducir / .ocr / .transcribir', 'Traduce texto, lee imágenes o transcribe audios.'],
    ['.shazam / .quitarvoz', 'Reconoce canciones o separa voz e instrumental.'],
    ['.checkhost / .pais / .tempmail', 'Revisa dominios, consulta países o crea correo temporal.']
  ],
  stickers: [
    ['.sticker / .s', 'Crea un sticker respondiendo a una imagen.'],
    ['.stickerwm paquete|autor', 'Crea un sticker con paquete y autor personalizados.'],
    ['.renombrarsticker paquete|autor', 'Cambia los datos del paquete de un sticker.'],
    ['.toimg', 'Convierte un sticker estático en imagen PNG.'],
    ['.textosticker', 'Crea un sticker usando solamente texto.'],
    ['.stickersearch', 'Busca paquetes de stickers por nombre.']
  ],
  administracion: [
    ['.antinsfw on/off', 'Activa o desactiva la moderación automática +18.'],
    ['.warns @usuario', 'Consulta las advertencias de un miembro del grupo.'],
    ['.resetwarn @usuario', 'Elimina las advertencias acumuladas de un miembro.'],
    ['.cola / .cancelardescarga', 'Consulta la cola o cancela tus descargas pendientes.'],
    ['.limpiarcola', 'Vacía las descargas pendientes; exclusivo para staff.']
  ]
}

const categoryMenus = {
  descargas: () => section('DESCARGAS', entries.descargas),
  buscadores: () => section('BUSCADORES', entries.buscadores),
  herramientas: () => section('HERRAMIENTAS', entries.herramientas),
  tools: () => section('HERRAMIENTAS', entries.herramientas),
  stickers: () => section('STICKERS', entries.stickers),
  administracion: () => section('ADMINISTRACIÓN', entries.administracion)
}

export const command = {
  name: 'menu',
  aliases: ['help', 'comandos', 'descargas', 'buscadores', 'herramientas', 'tools', 'stickers', 'administracion'],
  description: 'Muestra todos los comandos organizados por categorías.',
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
      section('DESCARGAS', entries.descargas),
      '',
      section('BUSCADORES', entries.buscadores),
      '',
      section('HERRAMIENTAS', entries.herramientas),
      '',
      section('STICKERS', entries.stickers),
      '',
      section('ADMINISTRACIÓN', entries.administracion)
    ].join('\n')

    try {
      const video = await fs.readFile(path.resolve(projectRoot, config.menuVideo))
      await sock.sendMessage(chat, { video, gifPlayback: true, caption: body, mentions: [sender] }, { quoted: msg })
    } catch {
      await sock.sendMessage(chat, { text: body, mentions: [sender] }, { quoted: msg })
    }
  }
}
