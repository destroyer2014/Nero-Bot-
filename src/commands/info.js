import config from '../../config.js'

export const command = {
  name: 'info',
  aliases: ['bot'],
  description: 'Muestra información del bot',

  async execute({ sock, msg, chat }) {
    const instance = config.instanceType === 'subbot' ? 'Subbot' : 'Bot principal'
    await sock.sendMessage(chat, {
      text: `🤖 *${config.botName}*\n📦 Versión: ${config.version}\n🔗 Instancia: ${instance}\n⚙️ Baileys: 7.0.0-rc13`
    }, { quoted: msg })
  }
}
