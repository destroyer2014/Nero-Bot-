export const supportCommand = {
  name: 'soporte',
  aliases: ['support', 'contacto', 'contactos'],
  description: 'Muestra los contactos oficiales de soporte de Nero.',
  async execute(ctx) {
    const text = [
      '「🛠️」 *Soporte oficial — Nero Bot AI*',
      '',
      '🌟 *Owners*',
      '• *Zemo*',
      '  wa.me/51917611323',
      '',
      '• *Smith*',
      '  wa.me/51921909260',
      '',
      '🧑🏻‍🔧 *Soporte*',
      '• *Mily*',
      '  wa.me/528691009825',
      '',
      '• *Kiwi*',
      '  wa.me/526636649636',
      '',
      '📧 *Correo*',
      'imperioarcadia2016@gmail.com',
      '',
      '✈️ *Telegram*',
      't.me/SoyZemo',
      '',
      '> 💡 Para reportar directamente un fallo usa *.reportar*.',
      '> Si acabas de recibir un código de error, *.reportar* puede enviarlo automáticamente.'
    ].join('\n')

    await ctx.sock.sendMessage(ctx.chat, { text }, { quoted: ctx.msg })
  }
}
