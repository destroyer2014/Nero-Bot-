import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../../config.js'
import { formatDateTime, jidToNumber } from '../lib/format.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

const item = (command, description) => [
  `✦ *${command}*`,
  `> ✐ ${description}`
].join('\n')

const section = (title, entries) => [
  `✦════ < ${title} > ════⚝`,
  '',
  ...entries.flatMap(entry => [item(...entry), ''])
].join('\n').trimEnd()

const sections = [
  {
    title: '📥 DESCARGAS',
    entries: [
      ['.tiktok • .tt + [url]', 'Descarga videos de TikTok.'],
      ['.ttimg • .ttmp3 + [url]', 'Descarga fotos o audio de una publicación de TikTok.'],
      ['.tts • .tiktoks + [búsqueda]', 'Busca videos de TikTok mediante una lista seleccionable.'],
      ['.ytmp3 • .play + [nombre o url]', 'Descarga audio de YouTube.'],
      ['.ytmp4 • .play2 + [nombre o url]', 'Descarga video de YouTube.'],
      ['.spotify • .ytmusic + [búsqueda]', 'Busca y descarga música.'],
      ['.fb • .facebook + [url]', 'Descarga videos de Facebook.'],
      ['.twitter • .x + [url]', 'Descarga videos o fotos de Twitter/X.'],
      ['.ig • .instagram + [url]', 'Descarga contenido de Instagram.'],
      ['.mediafire • .mf + [url]', 'Descarga archivos de MediaFire.'],
      ['.mega • .meganz + [url]', 'Descarga archivos de Mega.nz.'],
      ['.terabox • .tera + [url]', 'Descarga archivos de Terabox.'],
      ['.gitclone + [url]', 'Descarga repositorios de GitHub en ZIP.'],
      ['.npmdl • .npmdownloader + [paquete]', 'Descarga paquetes de NPM.'],
      ['.apk • .modapk + [nombre]', 'Busca y descarga APK.'],
      ['.animelinks • .animedl + [nombre] [ep]', 'Busca enlaces de episodios de anime.'],
      ['.pinterest • .pin + [búsqueda o url]', 'Busca o descarga imágenes de Pinterest.']
    ]
  },
  {
    title: '🛠️ HERRAMIENTAS',
    entries: [
      ['.sticker • .s', 'Crea un sticker desde una imagen o video.'],
      ['.stickersearch + [búsqueda]', 'Busca y descarga paquetes de stickers.'],
      ['.hd • .upscale • .restaurar', 'Mejora o restaura imágenes.'],
      ['.convertir • .comprimir • .removebg', 'Convierte, comprime o elimina fondos.'],
      ['.qr • .ytthumb • .ssweb', 'Genera QR, miniaturas o capturas web.'],
      ['.traducir • .ocr • .transcribir', 'Traduce, lee imágenes o transcribe audios.'],
      ['.fav', 'Muestra tus comandos favoritos.'],
      ['.favadd • .favdel', 'Añade o elimina comandos favoritos.']
    ]
  },
  {
    title: '🎭 REACCIONES',
    entries: [
      ['.reacciones', 'Muestra todas las reacciones con GIF y su traducción al español.']
    ]
  },
  {
    title: '🤖 INTELIGENCIA ARTIFICIAL',
    entries: [
      ['.ia • .gemini • .claude • .qwen', 'Conversa con los modelos de inteligencia artificial.'],
      ['.bot', 'Resume, corrige o analiza un mensaje citado.'],
      ['.imgprompt', 'Convierte una imagen en una descripción.'],
      ['.editimg', 'Edita una imagen con inteligencia artificial.'],
      ['.editqueue • .cancelaredit', 'Consulta o cancela una edición pendiente.']
    ]
  },
  {
    title: '🌸 ANIME',
    entries: [
      ['.animenews • .animeschedule', 'Muestra noticias y calendario de anime.'],
      ['.neko • .bluearchive', 'Envía imágenes anime aleatorias.']
    ]
  },
  {
    title: '🛡️ GRUPOS Y SEGURIDAD',
    entries: [
      ['.antinsfw • .antilink', 'Activa o desactiva funciones de seguridad.'],
      ['.warn • .warns • .resetwarn', 'Administra advertencias.'],
      ['.bienvenida • .despedida', 'Configura entradas y salidas.'],
      ['.setbienvenida • .setdespedida', 'Personaliza los mensajes de bienvenida y despedida.'],
      ['.promote • .demote • .kick', 'Administra participantes.'],
      ['.abrir • .cerrar', 'Abre o cierra el grupo.'],
      ['.tagall • .hidetag', 'Menciona a los participantes.'],
      ['.modo', 'Configura si Nero responde en chats privados.']
    ]
  },
  {
    title: '🤖 SUBBOTS',
    entries: [
      ['.code', 'Genera un código de vinculación para crear un subbot.'],
      ['.bots', 'Muestra los subbots conectados, su uptime y dispositivo.'],
      ['.setprincipal • .setbot', 'Elige la instancia principal del grupo.'],
      ['.principal • .resetprincipal', 'Consulta o restablece la instancia principal.'],
      ['.logout', 'Cierra y elimina la sesión del subbot.']
    ]
  },
  {
    title: '📨 SOPORTE',
    entries: [
      ['.reportar + [motivo]', 'Envía un reporte al Owner y SubOwner.']
    ]
  },
  {
    title: '👑 OWNER',
    entries: [
      ['.vv • .ownerinfo • .restart', 'Herramientas exclusivas del Owner y SubOwner autorizado.']
    ]
  }
]

export const command = {
  name: 'menu', aliases: ['help', 'comandos'], description: 'Muestra todos los comandos.',
  async execute({ sock, msg, chat, sender, instanceType }) {
    const { date, time } = formatDateTime(config.timezone)
    const mention = `@${jidToNumber(sender)}`
    const uptime = Math.floor(process.uptime())
    const hours = Math.floor(uptime / 3600)
    const minutes = Math.floor((uptime % 3600) / 60)
    const type = instanceType === 'subbot' || config.instanceType === 'subbot' ? 'Subbot' : 'Bot principal'

    const header = [
      `✦════ < 🖤 ${config.botName.toUpperCase()} > ════⚝`,
      '',
      `✦ *Usuario:* ${mention}`,
      `✦ *Creador:* ${config.creator}`,
      `✦ *Versión:* ${config.version}`,
      `✦ *Instancia:* ${type}`,
      `✦ *Tiempo activo:* ${hours} h ${minutes} min`,
      `✦ *Enlace:* ${config.website}`,
      `✦ *Fecha:* ${date}`,
      `✦ *Hora:* ${time}`,
      ''
    ].join('\n')

    const body = `${header}${sections.map(({ title, entries }) => section(title, entries)).join('\n\n')}\n\n✦════ < ✨ FIN DEL MENÚ > ════⚝`

    try {
      const video = await fs.readFile(path.resolve(projectRoot, config.menuVideo))
      await sock.sendMessage(chat, { video, gifPlayback: true, caption: body, mentions: [sender] }, { quoted: msg })
    } catch {
      await sock.sendMessage(chat, { text: body, mentions: [sender] }, { quoted: msg })
    }
  }
}
