import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../../config.js'
import { formatDateTime, jidToNumber } from '../lib/format.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const item = (command, description) => [`│ ✦ *${command}*`, `> ✐ ${description}`]
const section = (title, entries) => [`╭─❧ *${title}*`, ...entries.flatMap(entry => item(...entry)), '╰────────────❧'].join('\n')

const sections = {
  descargas: [
    ['.tiktok / .tt','Descarga videos de TikTok mediante enlace.'],
    ['.ttimg / .ttmp3','Descarga fotos o audio de TikTok.'],
    ['.tts / .tiktoks','Busca TikToks en una lista seleccionable.'],
    ['.play / .ytmp3 / .ytmp4','Busca y descarga audio o video de YouTube.'],
    ['.spotify / .ytmusic','Busca y descarga música.'],
    ['.instagram / .facebook / .twitter','Descarga contenido de redes sociales.'],
    ['.mediafire / .mega / .terabox','Descarga archivos desde enlaces.'],
    ['.gitclone / .npmdl','Descarga repositorios o paquetes NPM.'],
    ['.apk / .modapk','Busca y descarga APK.'],
    ['.animelinks / .animedl','Busca enlaces de episodios de anime.'],
    ['.pinterest / .pin','Busca o descarga imágenes de Pinterest.']
  ],
  herramientas: [
    ['.sticker / .s','Crea un sticker.'],
    ['.stickersearch','Busca y descarga paquetes de stickers.'],
    ['.hd / .upscale / .restaurar','Mejora o restaura imágenes.'],
    ['.convertir / .comprimir / .removebg','Convierte, comprime o elimina fondos.'],
    ['.qr / .ytthumb / .ssweb','Genera QR, miniaturas o capturas web.'],
    ['.traducir / .ocr / .transcribir','Traduce, lee imágenes o transcribe audios.'],
    ['.fav','Muestra tus comandos favoritos.'],
    ['.favadd / .favdel','Añade o elimina comandos favoritos.']
  ],
  inteligencia_artificial: [
    ['.ia / .gemini / .claude / .qwen','Conversa con los modelos de IA.'],
    ['.bot','Resume, corrige o analiza un mensaje citado.'],
    ['.imgprompt','Convierte una imagen en una descripción.'],
    ['.editimg','Edita una imagen con cola y cooldown.'],
    ['.editqueue / .cancelaredit','Consulta o cancela una edición.']
  ],
  anime_y_reacciones: [
    ['.animenews / .animeschedule','Noticias y calendario de anime.'],
    ['.neko / .bluearchive','Imágenes anime aleatorias.'],
    ['.reacciones','Abre la lista de acciones con GIF y traducción al español.']
  ],
  grupos_y_seguridad: [
    ['.antinsfw / .antilink','Seguridad y moderación.'],
    ['.warn / .warns / .resetwarn','Administra advertencias.'],
    ['.bienvenida / .despedida','Configura entradas y salidas.'],
    ['.setbienvenida / .setdespedida','Personaliza los mensajes.'],
    ['.promote / .demote / .kick','Administra participantes.'],
    ['.abrir / .cerrar','Abre o cierra el grupo.'],
    ['.tagall / .hidetag','Menciona a los participantes.'],
    ['.modo','Configura respuestas en privado.']
  ],
  subbots: [
    ['.code','Genera un código NERO para crear un subbot.'],
    ['.bots','Muestra subbots, uptime y dispositivo.'],
    ['.setprincipal / .setbot','Elige la instancia principal del grupo.'],
    ['.principal / .resetprincipal','Consulta o restablece la instancia.'],
    ['.logout','Cierra y elimina la sesión del subbot.']
  ],
  soporte_y_owner: [
    ['.reportar','Envía un reporte al Owner y SubOwner.'],
    ['.vv / .ownerinfo / .restart','Herramientas exclusivas del Owner.']
  ]
}

export const command = {
  name: 'menu', aliases: ['help','comandos'], description: 'Muestra todos los comandos.',
  async execute({ sock, msg, chat, sender, instanceType }) {
    const { date, time } = formatDateTime(config.timezone)
    const mention = `@${jidToNumber(sender)}`
    const uptime = Math.floor(process.uptime())
    const hours = Math.floor(uptime / 3600)
    const minutes = Math.floor((uptime % 3600) / 60)
    const body = [
      `╭─❧ *${config.botName}*`,
      `│ ✐ *Usuario ›* ${mention}`,
      `│ ✐ *Creador ›* ${config.creator}`,
      `│ ✐ *Versión ›* ${config.version}`,
      `│ ✐ *Instancia ›* ${instanceType === 'subbot' || config.instanceType === 'subbot' ? 'Subbot' : 'Bot principal'}`,
      `│ ✐ *Tiempo activo ›* ${hours} h ${minutes} min`,
      `│ ✐ *Link ›* ${config.website}`,
      `│ ✐ *Fecha ›* ${date}`,
      `│ ✐ *Hora ›* ${time}`,
      '╰────────────❧',
      '',
      ...Object.entries(sections).flatMap(([name, entries]) => [section(name.replaceAll('_',' ').toUpperCase(), entries), ''])
    ].join('\n')
    try {
      const video = await fs.readFile(path.resolve(projectRoot, config.menuVideo))
      await sock.sendMessage(chat, { video, gifPlayback: true, caption: body, mentions: [sender] }, { quoted: msg })
    } catch {
      await sock.sendMessage(chat, { text: body, mentions: [sender] }, { quoted: msg })
    }
  }
}
