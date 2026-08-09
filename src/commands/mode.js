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

export const modeCommand = {
  name: 'modo',
  aliases: ['mode'],
  description: 'Configura si Nero responde también en chats privados.',
  async execute(ctx) {
    assertPrivileged(ctx)

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
          '*.modepick groups* — Solo grupos\n' +
          '*.modepick all* — Grupos y privados'
      }, { quoted: ctx.msg })
    }
  }
}

export const modePickCommand = {
  name: 'modepick',
  aliases: [],
  async execute(ctx) {
    // El callback interno está protegido igual que .modo para impedir
    // que un usuario lo escriba manualmente y salte el selector.
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
