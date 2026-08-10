import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../../config.js'
import { formatDateTime, jidToNumber } from '../lib/format.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

const item = (command, description) =>
  [`✦ *${command}*`, `> ✐ ${description}`].join('\n')

const section = (title, entries) =>
  [
    `✦════ < ${title} > ════⚝`,
    '',
    ...entries.flatMap(entry => [item(...entry), ''])
  ].join('\n').trimEnd()

const sections = [
  {
    title: '🔎 BÚSQUEDAS',
    entries: [
      ['.play <búsqueda>', 'Busca en YouTube con lista seleccionable.'],
      ['.tts • .tiktoks <búsqueda>', 'Busca videos de TikTok con lista seleccionable.'],
      ['.spotify <búsqueda>', 'Busca canciones de Spotify.'],
      ['.ytmusic <búsqueda>', 'Busca música en YouTube Music.'],
      ['.applemusic <búsqueda o url>', 'Busca y descarga música de Apple Music.'],
      ['.bingimg <búsqueda>', 'Busca imágenes en Bing.'],
      ['.gif • .tenor <búsqueda>', 'Busca GIFs y videos cortos.'],
      ['.npm <paquete>', 'Consulta información de un paquete NPM.'],
      ['.googleimages <búsqueda>', 'Busca imágenes en Google.'],
      ['.wikipedia • .wiki <consulta>', 'Busca información en Wikipedia.'],
      ['.dni <8 dígitos>', 'Consulta nombres y código de verificación de un DNI peruano.'],
      ['.ruc <11 dígitos>', 'Consulta datos públicos de una empresa por RUC.']
    ]
  },
  {
    title: '📥 DESCARGAS',
    entries: [
      ['.tiktok • .tt <url>', 'Descarga videos de TikTok.'],
      ['.ttimg <url>', 'Descarga fotos de TikTok.'],
      ['.ttmp3 <url>', 'Descarga audio de TikTok.'],
      ['.ytmp3 <url>', 'Descarga audio de YouTube.'],
      ['.ytmp4 <url>', 'Descarga video de YouTube; usa archivo/partes si es pesado.'],
      ['.facebook • .fb <url>', 'Descarga contenido de Facebook.'],
      ['.twitter • .x <url>', 'Descarga contenido de Twitter/X.'],
      ['.instagram • .ig <url>', 'Descarga contenido de Instagram.'],
      ['.reddit <url>', 'Descarga contenido multimedia de Reddit.'],
      ['.bilibili • .bili <url>', 'Descarga videos de Bilibili.'],
      ['.threads <url>', 'Descarga imágenes y videos de Threads.'],
      ['.mediafire • .mf <url>', 'Descarga archivos de MediaFire.'],
      ['.mega • .meganz <url>', 'Descarga archivos de Mega.nz.'],
      ['.terabox • .tera <url>', 'Descarga archivos de Terabox.'],
      ['.gitclone <url>', 'Descarga repositorios de GitHub.'],
      ['.npmdl <paquete>', 'Descarga paquetes NPM.']
    ]
  },
  {
    title: '🎮 JUEGOS Y DIVERSIÓN',
    entries: [
      ['.ttt [@usuario]', 'Tres en raya; sin mención elige rival del grupo.'],
      ['.movie', 'Inicia Adivina la película con emojis.'],
      ['.movie <respuesta>', 'Intenta responder la película activa.'],
      ['.pareja [@usuario] [@usuario]', 'Calcula compatibilidad; sin menciones elige una pareja aleatoria.'],
      ['.testgay [@usuario]', 'Test meme aleatorio; sin mención elige a alguien del grupo.'],
      ['.ppt piedra|papel|tijera', 'Juega piedra, papel o tijera contra Nero.'],
      ['.dado', 'Lanza un dado.'],
      ['.moneda', 'Lanza una moneda.']
    ]
  },
  {
    title: '🖼️ STICKERS',
    entries: [
      ['.menusticker', 'Muestra el menú completo de stickers.'],
      ['.s • .sticker', 'Crea un sticker desde imagen o video corto.'],
      ['.setmeta Pack|Autor', 'Guarda tus metadatos personales de sticker.'],
      ['.delmeta', 'Elimina tus metadatos personales.'],
      ['.pfp • .getpic', 'Obtiene la foto de perfil de un usuario.'],
      ['.qc', 'Crea un sticker tipo quote desde un mensaje citado.'],
      ['.toimg • .img', 'Convierte un sticker en imagen.'],
      ['.brat • .ttp <texto>', 'Crea un sticker estático de texto.'],
      ['.attp <texto>', 'Crea un sticker animado de texto.'],
      ['.emojimix 😀 😍', 'Mezcla dos emojis en un sticker.'],
      ['.wm Pack|Autor', 'Cambia el pack/autor de un sticker existente.'],
      ['.textosticker • .tstk <texto>', 'Crea un sticker de texto local.'],
      ['.setpack <nombre>', 'Cambia el nombre global del paquete.'],
      ['.setauthor <autor>', 'Cambia el autor global del paquete.'],
      ['.stickermeta', 'Consulta los metadatos de stickers.'],
      ['.stickersearch <búsqueda>', 'Busca paquetes de stickers.']
    ]
  },
  {
    title: '🧩 GENERADORES',
    entries: [
      ['.animatedgif triggered|blink', 'Crea un GIF animado desde una imagen.'],
      ['.filtro', 'Muestra filtros seleccionables para una imagen.'],
      ['.textogif • .textgif <texto>', 'Genera un GIF animado de texto.'],
      ['.textoimagen • .textimg <texto>', 'Genera una imagen con texto.']
    ]
  },
  {
    title: '🛠️ UTILIDADES',
    entries: [
      ['.server • .serverinfo', 'Muestra el estado público del servidor de Nero.'],
      ['.ocr', 'Extrae texto de una imagen.'],
      ['.shazam • .whatmusic', 'Identifica música en audio o video.'],
      ['.acortar <url> [alias]', 'Acorta enlaces.'],
      ['.hostinfo <dominio>', 'Consulta información pública de un host.'],
      ['.minecraft <host> [edición]', 'Consulta un servidor Minecraft.'],
      ['.npmfull <paquete>', 'Envía la respuesta completa de NPM en JSON.'],
      ['.qr <texto>', 'Genera un código QR.'],
      ['.traducir <idioma> <texto>', 'Traduce textos.'],
      ['.ssweb <url>', 'Captura una página web.'],
      ['.hd • .upscale', 'Mejora imágenes.'],
      ['.removebg', 'Elimina el fondo de una imagen.'],
      ['.transcribir', 'Transcribe audio o video.']
    ]
  },
  {
    title: '🌸 ANIME Y REACCIONES',
    entries: [
      ['.reacciones', 'Muestra las reacciones normales.'],
      ['.animereacciones', 'Muestra las reacciones anime de EvoGB.'],
      ['.ar <tipo> [@usuario]', 'Envía una reacción anime.'],
      ['.girls random|sexy|asian', 'Envía una imagen SFW de la categoría.'],
      ['.animenews', 'Muestra noticias de anime.'],
      ['.animeschedule', 'Muestra el calendario de anime.']
    ]
  },
  {
    title: '🔎 STALKING PÚBLICO',
    entries: [
      ['.githubstalk <usuario>', 'Consulta información pública de GitHub.'],
      ['.instagramstalk <usuario>', 'Consulta información pública de Instagram.'],
      ['.robloxstalk <usuario>', 'Consulta información pública de Roblox.'],
      ['.telegramstalk <canal>', 'Consulta información pública de Telegram.'],
      ['.tiktokstalk <usuario>', 'Consulta información pública de TikTok.']
    ]
  },
  {
    title: '🔞 NSFW',
    entries: [
      ['.nsfwmenu', 'Muestra la sección adulta habilitada.'],
      ['.nsfwactivar on|off', 'Activa o desactiva comandos adultos en el grupo.'],
      ['.ph <búsqueda>', 'Busca videos en Pornhub.'],
      ['.xnxxsearch <búsqueda>', 'Busca videos en XNXX con lista seleccionable.'],
      ['.xvideossearch <búsqueda>', 'Busca videos en XVideos con lista seleccionable.']
    ]
  },
  {
    title: '🎴 GACHA',
    entries: [
      ['.w', 'Genera un personaje con su imagen para reclamar.'],
      ['.claim • .c', 'Reclama la aparición activa.'],
      ['.harem • .collection', 'Muestra tu colección.'],
      ['.character • .char <nombre/id>', 'Muestra la ficha de un personaje.'],
      ['.wish <personaje>', 'Añade un personaje a tu wishlist.'],
      ['.balance • .bal • .wallet', 'Consulta monedas, tickets y patrimonio.'],
      ['.daily', 'Recompensa diaria.'],
      ['.trade @usuario', 'Inicia un intercambio.'],
      ['.market', 'Muestra el mercado global.'],
      ['.battle', 'Combate PvE con tu equipo.'],
      ['.gachastats', 'Muestra tus estadísticas.'],
      ['.topgacha', 'Ranking general del Gacha.'],
      ['.gachaprofile', 'Muestra tu perfil Gacha.'],
      ['.gachainfo', 'Muestra TODOS los comandos Gacha.']
    ]
  },
  {
    title: '🛡️ GRUPOS Y SEGURIDAD',
    entries: [
      ['.antinsfw on|off', 'Activa o desactiva el detector NSFW.'],
      ['.antilink on|off', 'AntiLink global: borra enlaces y expulsa usuarios no administradores.'],
      ['.warn • .warns • .resetwarn', 'Administra advertencias.'],
      ['.bienvenida • .despedida', 'Configura entradas y salidas.'],
      ['.setimgbienvenida • .setimgdespedida', 'Configura imágenes de bienvenida/despedida.'],
      ['.promote • .demote • .kick', 'Administra participantes.'],
      ['.abrir • .cerrar', 'Abre o cierra el grupo.'],
      ['.tagall', 'Menciona a todos visiblemente.'],
      ['.hidetag <mensaje>', 'Menciona ocultamente a todos.'],
      ['.hidetagall', 'Reenvía un mensaje citado con mención oculta a todos.'],
      ['.del', 'Elimina un mensaje citado (admins).']
    ]
  },
  {
    title: '🤖 SUBBOTS',
    entries: [
      ['.code', 'Genera un código de vinculación.'],
      ['.bots', 'Muestra subbots conectados.'],
      ['.setbot', 'Selecciona la instancia del grupo (Owner/SubOwner).'],
      ['.principal', 'Consulta la instancia elegida.'],
      ['.resetprincipal', 'Vuelve a selección automática (Owner/SubOwner).'],
      ['.logout', 'Cierra la sesión del subbot.'],
      ['.modo', 'Configura grupos/privados (Owner/SubOwner).']
    ]
  },
  {
    title: '🤖 INTELIGENCIA ARTIFICIAL',
    entries: [
      ['.ia • .gemini', 'Conversa con IA.'],
      ['.bot', 'Analiza un mensaje citado.'],
      ['.imgprompt', 'Describe una imagen.'],
      ['.editimg', 'Edita una imagen con IA.']
    ]
  },
  {
    title: '📨 SOPORTE',
    entries: [
      ['.reportar [motivo]', 'Envía un reporte al equipo; sin motivo usa tu último error.'],
      ['.soporte', 'Muestra Owners y contactos oficiales de soporte.']
    ]
  },
  {
    title: '👑 OWNER / SUBOWNER',
    entries: [
      ['.vv', 'Recupera contenido de una visualización.'],
      ['.ownerinfo', 'Muestra información del Owner.'],
      ['.restart', 'Reinicia Nero.']
    ]
  }
]

export const command = {
  name: 'menu',
  aliases: ['help', 'comandos'],
  description: 'Muestra todos los comandos.',
  async execute({
    sock,
    msg,
    chat,
    sender,
    instanceType,
    botName,
    subbotConfig
  }) {
    const { date, time } = formatDateTime(config.timezone)
    const digits = jidToNumber(sender)
    const mention = `@${digits}`

    const localHour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: config.timezone,
        hour: '2-digit',
        hour12: false
      }).format(new Date())
    )

    const greeting = localHour >= 5 && localHour < 12
      ? {
          hello: 'buenos días 🌤',
          wish: 'espero que tengas un lindo día'
        }
      : localHour >= 12 && localHour < 19
        ? {
            hello: 'buenas tardes ☀️',
            wish: 'espero que tengas una linda tarde'
          }
        : {
            hello: 'buenas noches 🌙',
            wish: 'espero que tengas una linda noche'
          }

    const uptime = Math.floor(process.uptime())
    const hours = Math.floor(uptime / 3600)
    const minutes = Math.floor((uptime % 3600) / 60)

    const isSubbot =
      instanceType === 'subbot' ||
      config.instanceType === 'subbot'

    const type = isSubbot ? 'Subbot' : 'Bot principal'
    const displayBotName = isSubbot
      ? (botName || subbotConfig?.botName || config.botName)
      : config.botName

    const header = [
      '*︶꒦꒷☆꒷꒦︶꒦꒷☆꒷꒦︶꒦꒷☆꒷꒦︶꒦꒷☆꒷꒦︶*',
      '',
      `𑁯 “ Hola *${mention}*, ${greeting.hello}; soy *${displayBotName}*, ${greeting.wish} ” ᰍ`,
      '',
      '︵ׄ⏜︵ׄ⠑ ⏜ 𓊈  ⭐  𓊉 ⏜ ⠊︵ֺ⏜︵ֺ',
      `ׂ ✦ *Usuario:* ${mention}`,
      `✦ *Creador:* ${config.creator}`,
      `✦ *Versión:* ${config.version}`,
      `✦ *Instancia:* ${type}`,
      `✦ *Tiempo activo:* ${hours} h ${minutes} min`,
      `✦ *Enlace:* ${config.website}`,
      `✦ *Fecha:* ${date}`,
      `✦ *Hora:* ${time}`,
      '> Para ver comandos de administración de tu negocio usa *.salesinfo*',
      '*─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─⭒─ׄ─ׅ─ׄ─*'
    ].join('\n')

    // Fuerza el "Leer más" de WhatsApp sin llenar visualmente el menú.
    const readMore = '\u200e'.repeat(450)

    const body = [
      header,
      readMore,
      '*─ׄ─ׅ─ׄ─⭒ L I S T A  -  M E N Ú S ⭒─ׄ─ׅ─ׄ─*',
      '',
      sections.map(({ title, entries }) => section(title, entries)).join('\n\n'),
      '',
      '*✦════ < ✨ FIN DEL MENÚ > ════⚝*'
    ].join('\n')

    if (isSubbot && subbotConfig?.avatarUrl) {
      try {
        await sock.sendMessage(chat, {
          image: { url: subbotConfig.avatarUrl },
          caption: body,
          mentions: [sender]
        }, { quoted: msg })
        return
      } catch {}
    }

    try {
      const video = await fs.readFile(
        path.resolve(projectRoot, config.menuVideo)
      )
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
