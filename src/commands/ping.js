export const command = {
  name: 'ping',
  aliases: ['p'],
  description: 'Comprueba si el bot está activo',

  async execute({ sock, msg, chat }) {
    const start = performance.now()
    const sent = await sock.sendMessage(chat, { text: '🏓 Calculando...' }, { quoted: msg })
    const latency = Math.max(1, Math.round(performance.now() - start))

    await sock.sendMessage(chat, {
      text: `🏓 *Pong:* ${latency} ms`,
      edit: sent.key
    })
  }
}
