import config from '../../config.js'
import { sendInteractive, singleSelect } from '../lib/interactive.js'
import { getInstanceMode, setInstanceMode } from '../lib/modeStore.js'

function assertPrivileged(ctx) {
  const level = String(ctx.permissionLevel || 'user').toLowerCase()
  if (!['owner', 'subowner'].includes(level)) {
    throw new Error('Este comando es exclusivo para Owner y SubOwner.')
  }
}

function instanceLabel(ctx) {
  return ctx.instanceType === 'subbot'
    ? `Subbot ${ctx.instanceId || ''}`.trim()
    : 'Bot principal'
}

function activePrefix(ctx) {
  return ctx.prefix || ctx.subbotConfig?.prefix || config.prefix
}

export const modeCommand = {
  name: 'modo',
  aliases: ['mode'],
  description: 'Configura si Nero responde también en chats privados.',

  async execute(ctx) {
    assertPrivileged(ctx)

    const prefix = activePrefix(ctx)
    const current = getInstanceMode(ctx.instanceType, ctx.instanceId)
    const rows = [
      {
        title: 'Solo grupos',
        description: 'Ignora comandos normales en chats privados.',
        id: `${prefix}modepick groups`
      },
      {
        title: 'Grupos y privados',
        description: 'Responde comandos en grupos y chats privados.',
        id: `${prefix}modepick all`
      }
    ]

    const body = [
      `Instancia: *${instanceLabel(ctx)}*`,
      `Modo actual: *${current === 'groups' ? 'Solo grupos' : 'Grupos y privados'}*`,
      '',
      '🔐 Solo Owner/SubOwner puede cambiar esta configuración.',
      'Selecciona el nuevo comportamiento.'
    ].join('\n')

    try {
      await sendInteractive(ctx.sock, ctx.chat, {
        title: '⚙️ Modo de Nero',
        body,
        footer: 'Nero Bot • Configuración protegida',
        buttons: [
          singleSelect('Elegir modo', [
            { title: 'Privacidad de comandos', rows }
          ])
        ]
      }, ctx.msg)
    } catch {
      await ctx.sock.sendMessage(ctx.chat, {
        text:
          `${body}\n\n` +
          'Usa:\n' +
          `*${prefix}modepick groups* — Solo grupos\n` +
          `*${prefix}modepick all* — Grupos y privados`
      }, { quoted: ctx.msg })
    }
  }
}

export const modePickCommand = {
  name: 'modepick',
  aliases: [],
  async execute(ctx) {
    assertPrivileged(ctx)

    const requested = String(ctx.args?.[0] || '').toLowerCase()
    if (!['groups', 'all'].includes(requested)) {
      throw new Error('Selección inválida. Usa .modo para elegir una opción.')
    }

    const mode = setInstanceMode(ctx.instanceType, ctx.instanceId, requested)
    const label = mode === 'groups' ? 'Solo grupos' : 'Grupos y privados'

    await ctx.sock.sendMessage(ctx.chat, {
      text:
        `✅ *Modo actualizado:* ${label}\n` +
        `Instancia: *${instanceLabel(ctx)}*\n\n` +
        'En modo Solo grupos, *.code*, *.reportar*, *.menu*, *.ping* y *.modo* siguen disponibles en privado.'
    }, { quoted: ctx.msg })
  }
}

export const modeCommands = [modeCommand, modePickCommand]
