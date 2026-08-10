function uptimeText() {
  let seconds = Math.max(0, Math.floor(process.uptime()))
  const days = Math.floor(seconds / 86400)
  seconds %= 86400
  const hours = Math.floor(seconds / 3600)
  seconds %= 3600
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${days ? `${days}d ` : ''}${hours}h ${minutes}m ${secs}s`
}

function incomingLatency(msg) {
  try {
    const raw = Number(msg?.messageTimestamp || 0)
    if (!Number.isFinite(raw) || raw <= 0) return null
    const timestampMs = raw > 10_000_000_000 ? raw : raw * 1000
    const value = Date.now() - timestampMs
    return value >= 0 && value < 60_000 ? Math.round(value) : null
  } catch {
    return null
  }
}

export const command = {
  name: 'ping',
  aliases: ['p'],
  description: 'Comprueba latencia y tiempo activo de la instancia.',

  async execute({ sock, msg, chat, instanceType, botName }) {
    const latency = incomingLatency(msg)
    const instance = instanceType === 'subbot' ? 'Subbot' : 'Bot principal'

    await sock.sendMessage(chat, {
      text: [
        '「🏓」 *Pong!*',
        '',
        `⚡ Latencia: *${latency ?? '<1'} ms*`,
        `⏱️ Tiempo activo: *${uptimeText()}*`,
        `🤖 Instancia: *${instance}*`,
        botName ? `✦ Bot: *${botName}*` : '',
        '',
        '> Nero AI | © ArcadiaCorps'
      ].filter(Boolean).join('\n')
    }, { quoted: msg })
  }
}
