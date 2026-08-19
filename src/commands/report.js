import config from '../../config.js'
import { getRecentError } from '../lib/errorReports.js'

const jid = n => `${String(n).replace(/\D/g, '')}@s.whatsapp.net`

export const reportCommand = {
  name: 'reportar',
  aliases: ['report', 'bug'],
  description: 'Reporta un error.',
  async execute(ctx) {
    const recent = getRecentError(ctx.sender)
    const writtenReason = ctx.args.join(' ').trim()

    if (!writtenReason && !recent) {
      throw new Error(
        'Uso: .reportar <motivo>. Si acabas de recibir un error de Nero, también puedes usar solo .reportar.'
      )
    }

    const reason = writtenReason ||
      'El usuario reportó el último error generado por Nero.'

    const text = [
      '🚨 *Nuevo reporte de Nero Bot*',
      `Usuario: @${ctx.sender.split('@')[0]}`,
      `Chat: ${ctx.chat}`,
      `Instancia: ${ctx.instanceType === 'subbot' ? 'Subbot' : 'Bot principal'}`,
      `Motivo: ${reason}`,
      recent ? `Código: ${recent.code}` : 'Código: sin error asociado',
      recent ? `Comando: ${recent.command || 'desconocido'}` : '',
      recent ? `Error: ${recent.message}` : '',
      `Fecha: ${new Date().toLocaleString('es-PE', { timeZone: config.timezone })}`
    ].filter(Boolean).join('\n')

    const targets = [
      ...(config.ownerNumbers || []),
      ...(config.subOwnerNumbers || [])
    ].map(jid)

    for (const target of [...new Set(targets)]) {
      await ctx.sock.sendMessage(target, {
        text,
        mentions: [ctx.sender]
      }).catch(() => {})
    }

    await ctx.sock.sendMessage(ctx.chat, {
      text: '✅ Reporte enviado al equipo de Nero. Gracias por ayudar a mejorar el bot.'
    }, { quoted: ctx.msg })
  }
}
