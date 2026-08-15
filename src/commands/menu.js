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
  peliculas: {
    title: '🎬 MENU PELÍCULAS',
    description: 'Búsqueda, descarga y estado Premium de películas.',
    entries: [
      '.pelicula <nombre>',
      '.premium'
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
      '.delsubbotsrojos',
      '.addpremium <número>',
      '.delpremium <número>',
      '.premiumlist'
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
  ayuda: 'soporte',
  pelicula: 'peliculas',
  películas: 'peliculas',
  películas: 'peliculas',
  movie: 'peliculas',
  movies: 'peliculas'
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

const commandDescriptions = {
  play: 'Busca el mejor resultado de YouTube y permite elegir Audio o Video.',
  ytsearch: 'Busca varios videos de YouTube y deja elegir Audio o Video por resultado.',
  ytplaylist: 'Abre una playlist de YouTube y permite descargar una pista como Audio o Video.',
  tts: 'Busca videos de TikTok y permite seleccionar uno para descargar.',
  spotify: 'Busca o descarga canciones de Spotify.',
  ytmusic: 'Busca o descarga música desde YouTube Music.',
  applemusic: 'Busca o descarga canciones de Apple Music.',
  bingimg: 'Busca imágenes en Bing.',
  gif: 'Busca GIFs animados.',
  wikipedia: 'Busca información resumida en Wikipedia.',
  npm: 'Consulta información de un paquete de NPM.',
  dni: 'Consulta información disponible para un DNI peruano.',
  ruc: 'Consulta información disponible para un RUC peruano.',

  ytmp3: 'Descarga el audio de un video de YouTube.',
  ytmp4: 'Descarga un video de YouTube en la calidad indicada.',
  tiktok: 'Descarga un video o contenido de TikTok mediante su enlace.',
  ttimg: 'Descarga imágenes/fotos de una publicación de TikTok.',
  ttmp3: 'Extrae o descarga el audio de TikTok.',
  facebook: 'Descarga videos de Facebook.',
  instagram: 'Descarga contenido de Instagram.',
  twitter: 'Descarga contenido de X/Twitter.',
  reddit: 'Descarga multimedia de Reddit.',
  threads: 'Descarga imágenes o videos de Threads.',
  bilibili: 'Descarga videos de Bilibili.',
  mediafire: 'Descarga un archivo desde MediaFire.',
  mega: 'Descarga un archivo desde MEGA.',
  terabox: 'Explora y descarga archivos de TeraBox.',
  gitclone: 'Descarga un repositorio Git como archivo.',
  npmdl: 'Descarga un paquete publicado en NPM.',

  pelicula: 'Busca películas y permite elegir una para descargar.',
  premium: 'Muestra tu plan Premium y cuándo puedes descargar otra película.',

  ttt: 'Inicia una partida de tres en raya.',
  movie: 'Juego/actividad aleatoria de películas del bot.',
  pareja: 'Calcula de forma divertida la compatibilidad entre usuarios.',
  testgay: 'Test aleatorio de entretenimiento; no determina orientación real.',
  ppt: 'Juega piedra, papel o tijera contra Nero.',
  dado: 'Lanza un dado aleatorio.',
  moneda: 'Lanza una moneda al azar.',

  menusticker: 'Muestra las herramientas disponibles para stickers.',
  s: 'Convierte una imagen o video compatible en sticker.',
  qc: 'Crea un sticker estilo quote con texto.',
  toimg: 'Convierte un sticker en imagen.',
  brat: 'Genera un sticker estilo BRAT.',
  attp: 'Genera texto animado como sticker.',
  emojimix: 'Combina dos emojis en un sticker.',
  wm: 'Configura temporalmente el pack y autor del sticker.',
  setmeta: 'Define los metadatos del pack de stickers.',

  ping: 'Comprueba latencia aproximada y tiempo activo de Nero.',
  speedtest: 'Mide velocidad, ping y subida de la conexión del VPS.',
  server: 'Muestra estado, recursos y datos del servidor de Nero.',
  ocr: 'Extrae texto de una imagen.',
  shazam: 'Intenta reconocer una canción desde audio o video.',
  acortar: 'Acorta una URL.',
  hostinfo: 'Consulta información técnica básica de un dominio.',
  qr: 'Genera un código QR con el texto o enlace indicado.',
  traducir: 'Traduce texto al idioma indicado.',
  ssweb: 'Toma una captura de pantalla de una página web.',
  hd: 'Mejora una imagen compatible.',
  removebg: 'Elimina el fondo de una imagen.',
  transcribir: 'Transcribe una nota de voz o audio.',
  yttranscript: 'Obtiene la transcripción de un video de YouTube.',

  reacciones: 'Muestra el menú de reacciones disponibles.',
  animereacciones: 'Muestra reacciones con temática anime.',
  ar: 'Envía una reacción anime del tipo indicado.',
  girls: 'Obtiene imágenes aleatorias de la categoría seleccionada.',
  animenews: 'Consulta noticias recientes relacionadas con anime.',
  animeschedule: 'Consulta el calendario de emisiones de anime.',

  w: 'Obtiene un personaje aleatorio del sistema Gacha.',
  claim: 'Reclama un personaje disponible.',
  harem: 'Muestra tu colección de personajes.',
  character: 'Busca información de un personaje.',
  wish: 'Añade un personaje a tu lista de deseos.',
  balance: 'Muestra tu saldo del sistema Gacha.',
  daily: 'Reclama tu recompensa diaria.',
  trade: 'Inicia un intercambio con otro usuario.',
  market: 'Abre el mercado de personajes.',
  battle: 'Inicia un combate del sistema Gacha.',
  gachainfo: 'Muestra información y ayuda del sistema Gacha.',

  antilink: 'Activa o desactiva la expulsión automática por enlaces.',
  antinsfw: 'Activa o desactiva la moderación NSFW del grupo.',
  bienvenida: 'Activa o desactiva los mensajes de bienvenida.',
  despedida: 'Activa o desactiva los mensajes de despedida.',
  setbienvenida: 'Personaliza el texto de bienvenida del grupo.',
  setdespedida: 'Personaliza el texto de despedida del grupo.',
  setimgbienvenida: 'Configura la imagen usada en bienvenidas.',
  setimgdespedida: 'Configura la imagen usada en despedidas.',
  warn: 'Administra advertencias de usuarios y consulta sus warns.',
  promote: 'Asciende, degrada o expulsa usuarios según el comando usado.',
  abrir: 'Abre o cierra el grupo para que los miembros puedan escribir.',
  tagall: 'Menciona a todos o hace una mención oculta según el comando.',
  del: 'Elimina un mensaje respondiéndolo cuando Nero tiene permisos.',
  groupconfig: 'Muestra la configuración actual de moderación del grupo.',

  code: 'Genera un código para vincular una cuenta como SubBot.',
  bots: 'Muestra las instancias SubBot registradas.',
  setbot: 'Permite a un admin elegir qué instancia responderá en el grupo.',
  principal: 'Muestra el modo de enrutamiento y la instancia seleccionada.',
  resetprincipal: 'Devuelve el grupo al modo libre multi-instancia.',
  modo: 'Cambia el modo de operación de una instancia de Nero.',
  logout: 'Cierra la sesión del SubBot que ejecuta el comando.',
  delsubbot: 'Elimina un SubBot específico del VPS.',
  delsubbotsrojos: 'Limpia SubBots detenidos o dañados sin tocar los online.',

  ia: 'Responde consultas usando la inteligencia artificial configurada.',
  gemini: 'Consulta el modelo Gemini configurado.',
  bot: 'Hace que Nero responda al mensaje citado.',
  imgprompt: 'Genera o procesa un prompt para imágenes.',
  editimg: 'Edita una imagen usando las herramientas de IA disponibles.',

  soporte: 'Muestra los canales oficiales de soporte de Nero.',
  reportar: 'Reporta el último error o un problema al equipo.',

  nsfwmenu: 'Muestra los comandos de la sección NSFW.',
  nsfwactivar: 'Activa o desactiva la sección NSFW en el grupo.',
  ph: 'Busca contenido en el proveedor configurado para esta sección.',
  xnxxsearch: 'Busca resultados en XNXX.',
  xvideossearch: 'Busca resultados en XVideos.',

  vv: 'Recupera contenido de visualización única cuando está permitido.',
  ownerinfo: 'Muestra información y herramientas del Owner.',
  restart: 'Reinicia la instancia principal de Nero.',
  addpremium: 'Da acceso Premium ilimitado de películas a un número. Solo Owner.',
  delpremium: 'Quita el acceso Premium de películas a un número. Solo Owner.',
  premiumlist: 'Lista los usuarios Premium registrados. Solo Owner.'
}

function commandDescription(entry, category) {
  const match = String(entry || '').match(/^\.([^\s/]+)/)
  const key = String(match?.[1] || '').toLowerCase()
  return commandDescriptions[key] || category.description
}

function commandEntryLines(entry, category, prefix) {
  return [
    `┆ ✦ *${entry.replace(/^\./, prefix)}*`,
    `┆   ↳ ${commandDescription(entry, category)}`,
    '┆'
  ]
}

function categoryBody(category, prefix) {
  return [
    `╭─• ˚₊‧ ✦ *${category.title}* ‧₊˚ •─╮`,
    '┆',
    `┆ > ✐ ${category.description}`,
    '┆',
    ...category.entries.flatMap(entry => commandEntryLines(entry, category, prefix)),
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
    ['PELICULAS', 'peliculas', 'Búsqueda, descargas y Premium'],
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
