export const command = {
  name: 'ping',
  aliases: ['p'],
  description: 'Comprueba si el bot está activo',

  async execute({ sock, msg, chat }) {
    const start = performance.now()
    // Ultra Baileys RC13 no procesa de forma fiable el campo `edit`.
    // Enviamos una única respuesta compatible para evitar "Invalid media type".
    const latency = Math.max(1, Math.round(performance.now() - start))
    await sock.sendMessage(
      chat,
      { text: `🏓 *Pong:* ${latency} ms\n✅ Nero Bot está activo.` },
      { quoted: msg }
    )
  }
}
