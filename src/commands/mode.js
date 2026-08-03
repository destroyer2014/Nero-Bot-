import config from '../../config.js'
import { sendInteractive, singleSelect } from '../lib/interactive.js'
import { getInstanceMode, setInstanceMode } from '../lib/modeStore.js'

function assertAllowed(ctx) {
  if (!ctx.isOwner && !ctx.isSubOwner) {
    throw new Error('Solo el Owner o SubOwner puede cambiar el modo de esta instancia.')
  }
}

function instanceLabel(ctx) {
  return ctx.instanceType === 'subbot' ? `Subbot ${ctx.instanceId || ''}`.trim() : 'Bot principal'
}

export const modeCommand = {
  name: 'modo',
  aliases: ['mode'],
  description: 'Configura si Nero responde también en chats privados.',
  async execute(ctx) {
    assertAllowed(ctx)
    const current = getInstanceMode(ctx.instanceType, ctx.instanceId)
    const rows = [
      {
        title: 'Solo grupos',
        description: 'Ignora comandos normales en chats privados.',
        id: `${config.prefix}modepick groups`
      },
      {
        title: 'Grupos y privados',
        description: 'Responde comandos en grupos y chats privados.',
        id: `${config.prefix}modepick all`
      }
    ]

    const body = [
      `Instancia: *${instanceLabel(ctx)}*`,
      `Modo actual: *${current === 'groups' ? 'Solo grupos' : 'Grupos y privados'}*`,
      '',
      'Selecciona el nuevo comportamiento.'
    ].join('\n')

    try {
      await sendInteractive(ctx.sock, ctx.chat, {
        title: '⚙️ Modo de Nero',
        body,
        footer: 'Nero Bot • Configuración por instancia',
        buttons: [singleSelect('Elegir modo', [{ title: 'Privacidad de comandos', rows }])]
      }, ctx.msg)
    } catch {
      await ctx.sock.sendMessage(ctx.chat, {
        text: `${body}\n\nUsa:\n*.modepick groups* — Solo grupos\n*.modepick all* — Grupos y privados`
      }, { quoted: ctx.msg })
    }
  }
}

export const modePickCommand = {
  name: 'modepick',
  aliases: [],
  async execute(ctx) {
    assertAllowed(ctx)
    const requested = String(ctx.args?.[0] || '').toLowerCase()
    if (!['groups', 'all'].includes(requested)) {
      throw new Error('Selección inválida. Usa .modo para elegir una opción.')
    }
    const mode = setInstanceMode(ctx.instanceType, ctx.instanceId, requested)
    const label = mode === 'groups' ? 'Solo grupos' : 'Grupos y privados'
    await ctx.sock.sendMessage(ctx.chat, {
      text: `✅ *Modo actualizado:* ${label}\nInstancia: *${instanceLabel(ctx)}*\n\nEn modo Solo grupos, *.code*, *.reportar*, *.menu*, *.ping* y *.modo* siguen disponibles en privado.`
    }, { quoted: ctx.msg })
  }
}

export const modeCommands = [modeCommand, modePickCommand]
