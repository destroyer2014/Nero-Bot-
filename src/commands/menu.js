import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../../config.js'
import { formatDateTime, jidToNumber } from '../lib/format.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

const categories = {
  busqueda: {
    title: '🔎 MENU BÚSQUEDA',
    description: 'Buscadores, música e información.',
    entries: [
      '.play <nombre>',
      '.ytsearch <búsqueda>',
      '.ytplaylist <url> [límite]',
      '.tts <búsqueda>',
      '.spotify <búsqueda>',
      '.ytmusic <búsqueda>',
      '.applemusic <búsqueda>',
      '.bingimg <búsqueda>',
      '.gif <búsqueda>',
      '.wikipedia <consulta>',
      '.npm <paquete>',
      '.dni <8 dígitos>',
      '.ruc <11 dígitos>'
    ]
  },
  descargas: {
    title: '📥 MENU DESCARGAS',
    description: 'Descargas multimedia y archivos.',
    entries: [
      '.ytmp3 <url>',
      '.ytmp4 <url> [calidad]',
      '.tiktok <url>',
      '.ttimg <url>',
      '.ttmp3 <url>',
      '.facebook <url>',
      '.instagram <url>',
      '.twitter <url>',
      '.reddit <url>',
      '.threads <url>',
      '.bilibili <url>',
      '.mediafire <url>',
      '.mega <url>',
      '.terabox <url>',
      '.gitclone <url>',
      '.npmdl <paquete>'
    ]
  },
  juegos: {
    title: '🎮 MENU JUEGOS',
    description: 'Juegos y diversión para grupos.',
    entries: [
      '.ttt [@usuario]',
      '.movie',
      '.pareja [@usuario]',
      '.testgay [@usuario]',
      '.ppt piedra|papel|tijera',
      '.dado',
      '.moneda'
    ]
  },
  stickers: {
    title: '🖼️ MENU STICKERS',
    description: 'Creación y edición de stickers.',
    entries: [
      '.menusticker',
      '.s',
      '.qc',
      '.toimg',
      '.brat <texto>',
      '.attp <texto>',
      '.emojimix 😀 😍',
      '.wm Pack|Autor',
      '.setmeta Pack|Autor'
    ]
  },
  utilidades: {
    title: '🛠️ MENU UTILIDADES',
    description: 'Herramientas y diagnóstico.',
    entries: [
      '.ping',
      '.speedtest',
      '.server',
      '.ocr',
      '.shazam',
      '.acortar <url>',
      '.hostinfo <dominio>',
      '.qr <texto>',
      '.traducir <idioma> <texto>',
      '.ssweb <url>',
      '.hd',
      '.removebg',
      '.transcribir',
      '.yttranscript <url> [idioma]'
    ]
  },
  anime: {
    title: '🌸 MENU ANIME',
    description: 'Anime, reacciones y contenido visual.',
    entries: [
      '.reacciones',
      '.animereacciones',
      '.ar <tipo> [@usuario]',
      '.girls random|sexy|asian',
      '.animenews',
      '.animeschedule'
    ]
  },
  gacha: {
    title: '🎴 MENU GACHA',
    description: 'Colección, economía y combates.',
    entries: [
      '.w',
      '.claim',
      '.harem',
      '.character <nombre>',
      '.wish <personaje>',
      '.balance',
      '.daily',
      '.trade @usuario',
      '.market',
      '.battle',
      '.gachainfo'
    ]
  },
  grupos: {
    title: '🛡️ MENU GRUPOS',
    description: 'Administración y seguridad de grupos.',
    entries: [
      '.antilink on|off',
      '.antinsfw on|off',
      '.bienvenida on|off',
      '.despedida on|off',
      '.setbienvenida <texto>',
      '.setdespedida <texto>',
      '.setimgbienvenida',
      '.setimgdespedida',
      '.warn / .warns / .resetwarn',
      '.promote / .demote / .kick',
      '.abrir / .cerrar',
      '.tagall / .hidetag',
      '.del',
      '.groupconfig'
    ]
  },
  subbots: {
    title: '🤖 MENU SUBBOTS',
    description: 'Vinculación y control de instancias.',
    entries: [
      '.code',
      '.bots',
      '.setbot  — elegir una sola instancia',
      '.principal  — ver modo libre/seleccionado',
      '.resetprincipal  — admins del grupo',
      '.modo  — Owner/SubOwner',
      '.logout',
      '.delsubbot <número>  — Owner/SubOwner',
      '.delsubbotsrojos  — Owner/SubOwner'
    ]
  },
  ia: {
    title: '🤖 MENU IA',
    description: 'Inteligencia artificial.',
    entries: [
      '.ia <consulta>',
      '.gemini <consulta>',
      '.bot (responder mensaje)',
      '.imgprompt',
      '.editimg'
    ]
  },
  soporte: {
    title: '📨 MENU SOPORTE',
    description: 'Ayuda y reportes.',
    entries: [
      '.soporte',
      '.reportar [motivo]'
    ]
  },
  nsfw: {
    title: '🔞 MENU NSFW',
    description: 'Contenido adulto controlado por grupo.',
    entries: [
      '.nsfwmenu',
      '.nsfwactivar on|off',
      '.ph <búsqueda>',
      '.xnxxsearch <búsqueda>',
      '.xvideossearch <búsqueda>'
    ]
  },
  owner: {
    title: '👑 MENU OWNER',
    description: 'Herramientas protegidas.',
    entries: [
      '.vv',
      '.ownerinfo',
      '.restart',
      '.modo',
      '.delsubbot <número>',
      '.delsubbotsrojos'
    ]
  }
}

const aliases = {
  búsquedas: 'busqueda',
  busquedas: 'busqueda',
  búsqueda: 'busqueda',
  descargas: 'descargas',
  descarga: 'descargas',
  juego: 'juegos',
  sticker: 'stickers',
  utilidad: 'utilidades',
  grupo: 'grupos',
  subbot: 'subbots',
  inteligencia: 'ia',
  ayuda: 'soporte'
}

function uptimeText() {
  let seconds = Math.max(0, Math.floor(process.uptime()))
  const days = Math.floor(seconds / 86400)
  seconds %= 86400
  const hours = Math.floor(seconds / 3600)
  seconds %= 3600
  const minutes = Math.floor(seconds / 60)
  return `${days ? `${days} d ` : ''}${hours} h ${minutes} min`
}

function greetingForTimezone() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone,
    hour: '2-digit',
    hour12: false
  }).format(new Date()))

  if (hour >= 5 && hour < 12) {
    return { hello: 'buenos días 🌤', wish: 'espero que tengas un lindo día' }
  }
  if (hour >= 12 && hour < 19) {
    return { hello: 'buenas tardes ☀️', wish: 'espero que tengas una linda tarde' }
  }
  return { hello: 'buenas noches 🌙', wish: 'espero que tengas una linda noche' }
}

function categoryBody(category, prefix) {
  return [
    `╭─• ˚₊‧ ✦ *${category.title}* ‧₊˚ •─╮`,
    '┆',
    `┆ > ✐ ${category.description}`,
    '┆',
    ...category.entries.map(entry => `┆ ✦ *${entry.replace(/^\./, prefix)}*`),
    '┆',
    `┆ ↩ Volver: *${prefix}menu*`,
    '╰─── •·:*¨༺ ♱ ✦ ♱ ༻¨*:·• ───╯',
    '',
    '> Nero Bot™ | © ArcadiaCorps'
  ].join('\n')
}

function categoryList(prefix) {
  const rows = [
    ['BUSQUEDA', 'busqueda', 'Buscadores e información'],
    ['DESCARGAS', 'descargas', 'Multimedia y archivos'],
    ['JUEGOS', 'juegos', 'Diversión para grupos'],
    ['STICKERS', 'stickers', 'Creación y edición'],
    ['UTILIDADES', 'utilidades', 'Ping, Speedtest y herramientas'],
    ['ANIME', 'anime', 'Anime y reacciones'],
    ['GACHA', 'gacha', 'Colección y economía'],
    ['GRUPOS', 'grupos', 'Administración y seguridad'],
    ['SUBBOTS', 'subbots', 'Instancias de Nero'],
    ['IA', 'ia', 'Inteligencia artificial'],
    ['SOPORTE', 'soporte', 'Ayuda y reportes'],
    ['NSFW', 'nsfw', 'Sección adulta'],
    ['OWNER', 'owner', 'Herramientas protegidas']
  ]

  return rows.flatMap(([title, key, description]) => [
    `┆ ╰┈➤ *MENU ${title}*`,
    `┆ > ✐ ${description} — *${prefix}menu ${key}*`,
    '┆'
  ])
}

export const command = {
  name: 'menu',
  aliases: ['help', 'comandos'],
  description: 'Muestra el menú principal o una categoría.',

  async execute({
    sock,
    msg,
    chat,
    sender,
    args = [],
    instanceType,
    botName,
    subbotConfig,
    prefix
  }) {
    const activePrefix = prefix || subbotConfig?.prefix || config.prefix
    const requestedRaw = String(args[0] || '').toLowerCase().trim()
    const requested = aliases[requestedRaw] || requestedRaw

    if (requested) {
      const category = categories[requested]
      if (!category) {
        await sock.sendMessage(chat, {
          text: `❌ Menú no encontrado. Usa *${activePrefix}menu* para ver las categorías.`
        }, { quoted: msg })
        return
      }

      await sock.sendMessage(chat, {
        text: categoryBody(category, activePrefix)
      }, { quoted: msg })
      return
    }

    const { date, time } = formatDateTime(config.timezone)
    const digits = jidToNumber(sender)
    const mention = `@${digits}`
    const greeting = greetingForTimezone()
    const isSubbot = instanceType === 'subbot' || config.instanceType === 'subbot'
    const type = isSubbot ? 'Subbot' : 'Bot principal'
    const displayBotName = isSubbot
      ? (botName || subbotConfig?.botName || config.botName)
      : config.botName

    const body = [
      '*︶꒦꒷☆꒷꒦︶꒦꒷☆꒷꒦︶꒦꒷☆꒷꒦︶꒦꒷☆꒷꒦︶*',
      '',
      `𑁯 “ Hola *${mention}*, ${greeting.hello}; soy *${displayBotName}*, ${greeting.wish} ” ᰍ`,
      '',
      '︵ׄ⏜︵ׄ⠑ ⏜ 𓊈  ⭐  𓊉 ⏜ ⠊︵ֺ⏜︵ֺ',
      `ׂ ✦ *Usuario:* ${mention}`,
      `✦ *Creador:* ${config.creator}`,
      `✦ *Versión:* ${config.version}`,
      `✦ *Instancia:* ${type}`,
      `✦ *Tiempo activo:* ${uptimeText()}`,
      `✦ *Enlace:* ${config.website}`,
      `✦ *Fecha:* ${date}`,
      `✦ *Hora:* ${time}`,
      '',
      '*─ׄ─ׅ─ׄ─⭒ L I S T A  -  M E N Ú S ⭒─ׄ─ׅ─ׄ─*',
      '',
      '╭─• ˚₊‧ ✦ *NERO BOT | © ARCADIACORPS* ‧₊˚ •─╮',
      '┆',
      ...categoryList(activePrefix),
      '╰─── •·:*¨༺ ♱ ✦ ♱ ༻¨*:·• ───╯',
      '',
      '> Nero Bot™ | © ArcadiaCorps'
    ].join('\n')

    try {
      const video = await fs.readFile(path.resolve(projectRoot, config.menuVideo))
      await sock.sendMessage(chat, {
        video,
        gifPlayback: true,
        caption: body,
        mentions: [sender]
      }, { quoted: msg })
    } catch {
      await sock.sendMessage(chat, {
        text: body,
        mentions: [sender]
      }, { quoted: msg })
    }
  }
}
