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
