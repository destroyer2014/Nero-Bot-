import { downloadMediaMessage } from '@whiskeysockets/baileys'
import config from '../../config.js'
import { evoGet, requireEvoGbApiKey } from '../lib/api.js'
import { unwrapMessage } from '../lib/text.js'
import { enqueueEdit, getEditQueueStatus, cancelEdit, formatLeft } from '../lib/editImageQueue.js'

const NERO_PROMPT = 'Eres la IA de Nero Bot creada por ArcadiaCorps. Tu creador y dueño es Zemo. Responde en español, alegre, divertida, útil y ligeramente sarcástica. No inventes datos.'
const GEMINI_PROMPT = 'Eres la IA femenina oficial de ArcadiaCorps, empresa de software y programación. Tu creador es Zemo. Responde en español, alegre, divertida, útil y ligeramente sarcástica.'
const AI_CREDIT = '> Nero AI - IA de ArcadiaCorps'
const q = ctx => ctx.args.join(' ').trim()
const wrap=(name,aliases,fn)=>({name,aliases,async execute(ctx){try{await ctx.sock.sendMessage(ctx.chat,{react:{text:'⏳',key:ctx.msg.key}});await fn(ctx);await ctx.sock.sendMessage(ctx.chat,{react:{text:'✅',key:ctx.msg.key}})}catch(e){await ctx.sock.sendMessage(ctx.chat,{react:{text:'❌',key:ctx.msg.key}}).catch(()=>{});await ctx.sock.sendMessage(ctx.chat,{text:`❌ ${e.message}`},{quoted:ctx.msg})}}})
function quotedContext(msg){const m=unwrapMessage(msg.message||{});return m.extendedTextMessage?.contextInfo||m.imageMessage?.contextInfo||m.videoMessage?.contextInfo||m.documentMessage?.contextInfo}
function quotedText(msg){const qm=quotedContext(msg)?.quotedMessage;if(!qm)return '';const m=unwrapMessage(qm);return (m.conversation||m.extendedTextMessage?.text||m.imageMessage?.caption||m.videoMessage?.caption||m.documentMessage?.caption||'').trim()}
async function quotedBuffer(ctx){const c=quotedContext(ctx.msg);if(!c?.quotedMessage)return null;const target={key:{remoteJid:ctx.msg.key.remoteJid,id:c.stanzaId,participant:c.participant},message:c.quotedMessage};try{return await downloadMediaMessage(target,'buffer',{}, {logger:console,reuploadRequest:ctx.sock.updateMediaMessage})}catch{return null}}
async function multipart(endpoint, buffer, params = {}) {
  const key = requireEvoGbApiKey()
  const base = process.env.EVOGB_API_BASE_URL || 'https://api.evogb.org'
  const url = new URL(endpoint, base)
  url.searchParams.set('key', key)
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value))
  }

  const form = new FormData()
  form.append('file', new Blob([buffer], { type: 'image/png' }), 'imagen.png')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 180_000)
  try {
    const r = await fetch(url, { method: 'POST', body: form, signal: controller.signal })
    const type = (r.headers.get('content-type') || '').toLowerCase()
    if (type.startsWith('image/')) return { binary: Buffer.from(await r.arrayBuffer()) }

    const raw = await r.text()
    let d
    try { d = JSON.parse(raw) } catch { throw new Error(raw.slice(0, 300) || `HTTP ${r.status}`) }
    if (!r.ok || d.status === false || (d.code && Number(d.code) >= 400)) {
      throw new Error(d.message || d.error || `HTTP ${r.status}`)
    }
    return d
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('La edición de imagen tardó demasiado en responder.')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function traducirAlEspanol(texto) {
  const original = String(texto || '').trim()
  if (!original) return original
  try {
    const d = await evoGet('/tools/translate', { text: original, to: 'es' })
    return d?.data?.message || d?.result || d?.message || original
  } catch {
    return original
  }
}
function splitText(text,max=3500){const chunks=[];let rest=String(text||'');while(rest.length>max){let cut=rest.lastIndexOf('\n',max);if(cut<max*0.5)cut=max;chunks.push(rest.slice(0,cut));rest=rest.slice(cut).trimStart()}if(rest)chunks.push(rest);return chunks}
async function sendAi(ctx,title,result){for(const [i,part] of splitText(result).entries())await ctx.sock.sendMessage(ctx.chat,{text:`${i===0?`🤖 *${title}*\n\n`:''}${part}${i===splitText(result).length-1?`\n\n${AI_CREDIT}`:''}`},{quoted:i===0?ctx.msg:undefined})}
export const ia=wrap('ia',['chatgpt','gpt','ask'],async ctx=>{const text=q(ctx);if(!text)throw new Error(`Uso: ${config.prefix}ia <pregunta>`);const d=await evoGet('/ai/gptprompt',{text,prompt:NERO_PROMPT});await sendAi(ctx,'Nero IA',d.result)})
export const gemini=wrap('gemini',['gem'],async ctx=>{const text=q(ctx);if(!text)throw new Error(`Uso: ${config.prefix}gemini <pregunta>`);const d=await evoGet('/ai/gemini',{text,prompt:GEMINI_PROMPT});await sendAi(ctx,'Gemini',d.result)})
export const claude=wrap('claude',['devai'],async ctx=>{const text=q(ctx);if(!text)throw new Error(`Uso: ${config.prefix}claude <pregunta>`);const d=await evoGet('/ai/claude',{text});await sendAi(ctx,'Claude',d.result)})
export const qwen=wrap('qwen',[],async ctx=>{const text=q(ctx);if(!text)throw new Error(`Uso: ${config.prefix}qwen <pregunta>`);const d=await evoGet('/ai/qwen',{text});await sendAi(ctx,'Qwen',d.result)})
export const bot=wrap('bot',[],async ctx=>{const instruction=q(ctx)||'Resume este mensaje';const source=quotedText(ctx.msg);if(!source)throw new Error(`Responde a un mensaje de texto y escribe ${config.prefix}bot <instrucción>`);const d=await evoGet('/ai/gptprompt',{text:`Instrucción: ${instruction}\n\nMensaje citado:\n${source}`,prompt:NERO_PROMPT});await sendAi(ctx,'Nero analiza el mensaje',d.result)})
export const imgprompt = wrap('imgprompt', ['describeimg'], async ctx => {
  const b = await quotedBuffer(ctx)
  if (!b) throw new Error(`Responde a una imagen con ${config.prefix}imgprompt`)

  const d = await multipart('/ai/image-to-prompt', b, { method: 'local', language: 'es' })
  const original = d.prompt || d.result || 'Sin descripción.'
  const promptEs = await traducirAlEspanol(original)

  await ctx.sock.sendMessage(ctx.chat, {
    text: `🖼️ *Prompt de imagen*\n\n${promptEs}\n\n${AI_CREDIT}`
  }, { quoted: ctx.msg })
})
export const editimg = wrap('editimg', ['nanobanana', 'nano', 'editar'], async ctx => {
  const prompt = q(ctx)
  if (!prompt) throw new Error(`Uso: ${config.prefix}editimg <cambio que deseas> respondiendo a una imagen`)

  const b = await quotedBuffer(ctx)
  if (!b) throw new Error(`Responde a una imagen con ${config.prefix}editimg <instrucción>`)

  const { promise, position } = enqueueEdit({
    userId: ctx.sender,
    onStart: async () => {
      await ctx.sock.sendMessage(ctx.chat, {
        text: `🎨 *Procesando tu imagen con IA…*\n\n${AI_CREDIT}`
      }, { quoted: ctx.msg })
    },
    run: async () => {
      const d = await multipart('/ai/nanobanana', b, { method: 'local', prompt })
      if (d.binary) {
        return ctx.sock.sendMessage(ctx.chat, {
          image: d.binary,
          caption: `✨ *Imagen editada con IA*\n${AI_CREDIT}`
        }, { quoted: ctx.msg })
      }
      const url = d.result || d.url || d.image || d.data?.url || d.data?.result || d.data?.image
      if (!url) throw new Error('NanoBanana no entregó una imagen válida.')
      return ctx.sock.sendMessage(ctx.chat, {
        image: { url },
        caption: `✨ *Imagen editada con IA*\n${AI_CREDIT}`
      }, { quoted: ctx.msg })
    }
  })

  await ctx.sock.sendMessage(ctx.chat, {
    text: `⏳ *Imagen añadida a la cola*\nPosición aproximada: ${position}\n\n${AI_CREDIT}`
  }, { quoted: ctx.msg })
  await promise
})

export const editqueue = {
  name: 'editqueue', aliases: ['colaedit'],
  async execute(ctx) {
    const status = getEditQueueStatus(ctx.sender)
    const cooldown = status.cooldownMs > 0 ? `\nCooldown: ${formatLeft(status.cooldownMs)}` : ''
    await ctx.sock.sendMessage(ctx.chat, {
      text: `🎨 *Cola de edición IA*\nProcesando: ${status.processing ? 'Sí' : 'No'}\nEn espera: ${status.waiting}\nTu posición: ${status.position || 'No estás en cola'}${cooldown}\n\n${AI_CREDIT}`
    }, { quoted: ctx.msg })
  }
}

export const cancelaredit = {
  name: 'cancelaredit', aliases: ['canceledit'],
  async execute(ctx) {
    const ok = cancelEdit(ctx.sender)
    await ctx.sock.sendMessage(ctx.chat, {
      text: ok ? `✅ Solicitud retirada de la cola.\n\n${AI_CREDIT}` : `❌ No tienes una edición pendiente que pueda cancelarse.\n\n${AI_CREDIT}`
    }, { quoted: ctx.msg })
  }
}

export const aiCommands=[ia,gemini,claude,qwen,bot,imgprompt,editimg,editqueue,cancelaredit]
