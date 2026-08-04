import config from '../../config.js'
import { evoGet } from '../lib/api.js'

const reactions = [
  { name:'hug', aliases:['abrazo','abrazar'], type:'hug', label:'Abrazar a alguien', action:'abrazó a', emoji:'🤗', target:true },
  { name:'kiss', aliases:['beso','besar'], type:'kiss', label:'Besar a alguien', action:'besó a', emoji:'💋', target:true },
  { name:'pat', aliases:['acariciar','palmadita'], type:'pat', label:'Acariciar a alguien', action:'acarició a', emoji:'🥹', target:true },
  { name:'slap', aliases:['bofetada','cachetada'], type:'slap', label:'Dar una bofetada', action:'le dio una bofetada a', emoji:'👋', target:true },
  { name:'punch', aliases:['golpear','puñetazo'], type:'punch', label:'Dar un puñetazo', action:'golpeó a', emoji:'🥊', target:true },
  { name:'kick', aliases:['patear','patada','patea','pateae'], type:'kick', label:'Dar una patada', action:'pateó a', emoji:'🦵', target:true },
  { name:'bite', aliases:['morder'], type:'bite', label:'Morder a alguien', action:'mordió a', emoji:'🦷', target:true },
  { name:'bonk', aliases:['mazazo'], type:'bonk', label:'Dar un bonk', action:'le dio un bonk a', emoji:'🔨', target:true },
  { name:'bully', aliases:['molestar'], type:'bully', label:'Molestar a alguien', action:'molestó a', emoji:'😈', target:true },
  { name:'highfive', aliases:['chocalas','chocar'], type:'highfive', label:'Chocar los cinco', action:'chocó los cinco con', emoji:'✋', target:true },
  { name:'handhold', aliases:['tomarmano'], type:'handhold', label:'Tomar de la mano', action:'tomó de la mano a', emoji:'🤝', target:true },
  { name:'cuddle', aliases:['acurrucar'], type:'cuddle', label:'Acurrucarse con alguien', action:'se acurrucó con', emoji:'🫂', target:true },
  { name:'wave', aliases:['saludar'], type:'wave', label:'Saludar a alguien', action:'saludó a', emoji:'👋', target:true },
  { name:'kill', aliases:['matar'], type:'kill', label:'Derrotar de forma ficticia', action:'derrotó de forma ficticia a', emoji:'💀', target:true },
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
  return m.extendedTextMessage?.contextInfo || m.imageMessage?.contextInfo || m.videoMessage?.contextInfo || m.documentMessage?.contextInfo || {}
}

function mentionName(jid = '') {
  return `@${String(jid).split('@')[0].split(':')[0]}`
}

function findMediaUrl(value, depth = 0) {
  if (depth > 5 || value == null) return ''
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMediaUrl(item, depth + 1)
      if (found) return found
    }
    return ''
  }
  if (typeof value === 'object') {
    const preferred = ['url', 'gif', 'video', 'image', 'result', 'data', 'media', 'link', 'download_url']
    for (const key of preferred) {
      if (key in value) {
        const found = findMediaUrl(value[key], depth + 1)
        if (found) return found
      }
    }
    for (const child of Object.values(value)) {
      const found = findMediaUrl(child, depth + 1)
      if (found) return found
    }
  }
  return ''
}

function typedTarget(args = []) {
  const match = args.join(' ').match(/@(\d{7,20})/)
  return match ? `${match[1]}@s.whatsapp.net` : ''
}

async function sendReactionMedia(ctx, url, caption, mentions) {
  try {
    await ctx.sock.sendMessage(ctx.chat, {
      video: { url },
      gifPlayback: true,
      caption,
      mentions
    }, { quoted: ctx.msg })
  } catch (videoError) {
    try {
      await ctx.sock.sendMessage(ctx.chat, {
        image: { url },
        caption,
        mentions
      }, { quoted: ctx.msg })
    } catch {
      throw videoError
    }
  }
}

function makeReaction(def) {
  return {
    name: def.name,
    aliases: def.aliases,
    description: def.label,
    async execute(ctx) {
      const ci = contextInfo(ctx.msg)
      const target = ci?.mentionedJid?.[0] || ci?.participant || typedTarget(ctx.args)

      if (def.target && !target) {
        await ctx.sock.sendMessage(ctx.chat, {
          text: [
            '❌ Debes mencionar a una persona o responder a su mensaje.',
            '',
            `Ejemplo: *${config.prefix}${def.name} @usuario*`
          ].join('\n')
        }, { quoted: ctx.msg })
        return
      }

      const data = await evoGet('/sfw/rnd/v2', { type: def.type })
      const url = findMediaUrl(data)
      if (!url) throw new Error(`La API no entregó un GIF válido para “${def.label}”.`)

      const actor = mentionName(ctx.sender)
      const caption = def.target
        ? `${def.emoji} *${actor} ${def.action} ${mentionName(target)}.*\n> ✐ ${def.label}.`
        : `${def.emoji} *${actor} ${def.action}.*\n> ✐ ${def.label}.`
      const mentions = def.target ? [ctx.sender, target] : [ctx.sender]
      await sendReactionMedia(ctx, url, caption, mentions)
    }
  }
}

export const reactionsMenu = {
  name: 'reacciones', aliases: ['reactions', 'acciones'], description: 'Muestra todas las reacciones con GIF.',
  async execute(ctx) {
    const body = [
      '✦════ < 🎭 REACCIONES > ════⚝',
      '',
      ...reactions.flatMap(reaction => [
        `✦ *${config.prefix}${reaction.name}${reaction.target ? ' @usuario' : ''}*`,
        `> ✐ ${reaction.label}.`,
        ''
      ]),
      '✦════ < ✨ FIN DE REACCIONES > ════⚝'
    ].join('\n')

    await ctx.sock.sendMessage(ctx.chat, { text: body }, { quoted: ctx.msg })
  }
}

export const reactionCommands = [reactionsMenu, ...reactions.map(makeReaction)]
