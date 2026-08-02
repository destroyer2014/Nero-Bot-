import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../../config.js'
import { formatDateTime, jidToNumber } from '../lib/format.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

export const command = {
  name: 'menu',
  aliases: ['help', 'comandos'],
  description: 'Muestra el menú principal de Nero Bot',

  async execute({ sock, msg, chat, sender }) {
    const { date, time } = formatDateTime(config.timezone)
    const number = jidToNumber(sender)
    const mention = `@${number}`
    const typeLabel = config.instanceType.toLowerCase() === 'subbot' ? 'Subbot' : 'Bot principal'

    const caption = [
      `╭━━━〔 *${config.botName}* 〕━━━⬣`,
      `┃ 👤 Usuario: ${mention}`,
      `┃ 📅 Fecha: ${date}`,
      `┃ 🕒 Hora: ${time}`,
      `┃ 🤖 Versión: ${config.version}`,
      `┃ 🔗 Instancia: ${typeLabel}`,
      '╰━━━━━━━━━━━━━━━━⬣',
      '',
      `╭━━━〔 *COMANDOS* 〕━━━⬣`,
      `┃ ${config.prefix}menu`,
      `┃ ${config.prefix}ping`,
      `┃ ${config.prefix}info`,
      '┃',
      '┃ *DESCARGAS*',
      `┃ ${config.prefix}play <nombre>`,
      `┃ ${config.prefix}ytmp3 <url>`,
      `┃ ${config.prefix}ytmp4 <url>`,
      `┃ ${config.prefix}spotify <nombre/url>`,
      `┃ ${config.prefix}ytmusic <nombre/url>`,
      `┃ ${config.prefix}apk <nombre>`,
      `┃ ${config.prefix}apkmod <nombre>`,
      `┃ ${config.prefix}pinterest <nombre/url>`,
      `┃ ${config.prefix}instagram <url>`,
      `┃ ${config.prefix}facebook <url>`,
      `┃ ${config.prefix}twitch <url>`,
      `┃ ${config.prefix}threads <url>`,
      `┃ ${config.prefix}dl <url>`,
      `┃ ${config.prefix}mediafire <url>`,
      `┃ ${config.prefix}mega <url>`,
      `┃ ${config.prefix}terabox <url>`,
      `┃ ${config.prefix}anime <nombre> [episodio]`,
      '┃',
      '┃ *COLAS*',
      `┃ ${config.prefix}cola`,
      `┃ ${config.prefix}cancelardescarga`,
      `┃ ${config.prefix}limpiarcola (staff)`,
      '╰━━━━━━━━━━━━━━━━⬣'
    ].join('\n')

    const videoPath = path.resolve(projectRoot, config.menuVideo)
    const video = await fs.readFile(videoPath)

    await sock.sendMessage(
      chat,
      {
        video,
        gifPlayback: true,
        caption,
        mentions: [sender]
      },
      { quoted: msg }
    )
  }
}
