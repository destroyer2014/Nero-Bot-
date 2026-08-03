import config from '../../config.js'
import { evoGet } from '../lib/api.js'
import { sendInteractive, singleSelect } from '../lib/interactive.js'

const reactions = [
  { name:'hug', aliases:['abrazo','abrazar'], type:'hug', label:'Abrazar', action:'abrazó a', emoji:'🤗', target:true },
  { name:'kiss', aliases:['beso','besar'], type:'kiss', label:'Besar', action:'besó a', emoji:'💋', target:true },
  { name:'pat', aliases:['acariciar','palmadita'], type:'pat', label:'Acariciar', action:'acarició a', emoji:'🥹', target:true },
  { name:'slap', aliases:['bofetada','cachetada'], type:'slap', label:'Dar una bofetada', action:'le dio una bofetada a', emoji:'👋', target:true },
  { name:'punch', aliases:['golpear','puñetazo'], type:'punch', label:'Dar un puñetazo', action:'golpeó a', emoji:'🥊', target:true },
  { name:'kick', aliases:['patear','patada','patea'], type:'kick', label:'Dar una patada', action:'pateó a', emoji:'🦵', target:true },
  { name:'bite', aliases:['morder'], type:'bite', label:'Morder', action:'mordió a', emoji:'🦷', target:true },
  { name:'bonk', aliases:['mazazo'], type:'bonk', label:'Dar un bonk', action:'le dio un bonk a', emoji:'🔨', target:true },
  { name:'bully', aliases:['molestar'], type:'bully', label:'Molestar', action:'molestó a', emoji:'😈', target:true },
  { name:'highfive', aliases:['chocalas','chocar'], type:'highfive', label:'Chocar los cinco', action:'chocó los cinco con', emoji:'✋', target:true },
  { name:'handhold', aliases:['tomarmano'], type:'handhold', label:'Tomar de la mano', action:'tomó de la mano a', emoji:'🤝', target:true },
  { name:'cuddle', aliases:['acurrucar'], type:'cuddle', label:'Acurrucarse', action:'se acurrucó con', emoji:'🫂', target:true },
  { name:'wave', aliases:['saludar'], type:'wave', label:'Saludar', action:'saludó a', emoji:'👋', target:true },
  { name:'kill', aliases:['matar'], type:'kill', label:'Ataque ficticio', action:'derrotó de forma ficticia a', emoji:'💀', target:true },
  { name:'cry', aliases:['llorar','llora'], type:'cry', label:'Llorar', action:'está llorando', emoji:'😢', target:false },
  { name:'laugh', aliases:['reir','risa'], type:'laugh', label:'Reír', action:'se está riendo', emoji:'😂', target:false },
  { name:'blush', aliases:['sonrojar'], type:'blush', label:'Sonrojarse', action:'se sonrojó', emoji:'☺️', target:false },
  { name:'shy', aliases:['timido','timida'], type:'shy', label:'Sentir timidez', action:'siente mucha timidez', emoji:'🙈', target:false },
  { name:'sleep', aliases:['dormir','duerme'], type:'sleep', label:'Dormir', action:'se quedó dormido/a', emoji:'😴', target:false },
  { name:'dance', aliases:['bailar','baila'], type:'dance', label:'Bailar', action:'está bailando', emoji:'💃', target:false },
  { name:'smile', aliases:['sonreir','sonrie'], type:'smile', label:'Sonreír', action:'está sonriendo', emoji:'😊', target:false },
  { name:'happy', aliases:['feliz'], type:'happy', label:'Estar feliz', action:'está muy feliz', emoji:'🥳', target:false },
  { name:'sad', aliases:['triste'], type:'sad', label:'Estar triste', action:'está triste', emoji:'😔', target:false },
  { name:'angry', aliases:['enojado','enojada'], type:'angry', label:'Enojarse', action:'está muy enojado/a', emoji:'😡', target:false }
]

function contextInfo(msg) {
  const m = msg?.message || {}
  return m.extendedTextMessage?.contextInfo || m.imageMessage?.contextInfo || m.videoMessage?.contextInfo || {}
}
function mentionName(jid='') { return `@${String(jid).split('@')[0].split(':')[0]}` }
function mediaUrl(data) { return data?.result || data?.url || data?.data?.url || data?.data?.result }

function makeReaction(def) {
  return {
    name: def.name,
    aliases: def.aliases,
    description: def.label,
    async execute(ctx) {
      const ci = contextInfo(ctx.msg)
      const target = ci?.mentionedJid?.[0] || ci?.participant || ''
      if (def.target && !target) throw new Error(`Menciona a alguien. Ejemplo: ${config.prefix}${def.name} @usuario`)
      const data = await evoGet('/sfw/rnd/v2', { type: def.type })
      const url = mediaUrl(data)
      if (!url) throw new Error(`La API no entregó un GIF para “${def.label}”.`)
      const actor = mentionName(ctx.sender)
      const caption = def.target
        ? `${def.emoji} *${actor} ${def.action} ${mentionName(target)}.*\n> Acción: ${def.label}`
        : `${def.emoji} *${actor} ${def.action}.*\n> Acción: ${def.label}`
      const mentions = def.target ? [ctx.sender, target] : [ctx.sender]
      await ctx.sock.sendMessage(ctx.chat, { video: { url }, gifPlayback: true, caption, mentions }, { quoted: ctx.msg })
    }
  }
}

export const reactionsMenu = {
  name: 'reacciones', aliases: ['reactions','acciones'], description: 'Abre la lista de reacciones con GIF.',
  async execute(ctx) {
    const rows = reactions.map(r => ({
      title: `${r.emoji} ${r.label}`,
      description: r.target ? `Usa ${config.prefix}${r.name} @usuario` : `Usa ${config.prefix}${r.name}`,
      id: r.target ? `${config.prefix}${r.name} @usuario` : `${config.prefix}${r.name}`
    }))
    const body = ['🎭 *Reacciones de Nero*', '', 'Selecciona una acción. Las opciones con otra persona requieren mencionar a un usuario.', '', `Ejemplo: *${config.prefix}slap @usuario*`].join('\n')
    try {
      await sendInteractive(ctx.sock, ctx.chat, {
        title: '🎭 Reacciones Anime', body, footer: 'Nero Bot • Acciones traducidas al español',
        buttons: [singleSelect('Ver reacciones', [{ title: 'Reacciones disponibles', rows }])]
      }, ctx.msg)
    } catch {
      await ctx.sock.sendMessage(ctx.chat, { text: `${body}\n\n${reactions.map(r => `• *${config.prefix}${r.name}* — ${r.label}`).join('\n')}` }, { quoted: ctx.msg })
    }
  }
}

export const reactionCommands = [reactionsMenu, ...reactions.map(makeReaction)]
