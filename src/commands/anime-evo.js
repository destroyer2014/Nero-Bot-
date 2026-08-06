import config from '../../config.js'
import { evoGet, requireEvoGbApiKey } from '../lib/api.js'

const reactions = ['peek','comfort','thinkhard','curious','sniff','stare','trip','blowkiss','snuggle','angry','bleh','bored','clap','coffee','dramatic','cold','kisscheek','sing','tickle','scream','push','nope','jump','heat','gaming','draw','call','laugh','love','pout','punch','run','sad','scared','shy','sleep','spit','step','think','walk','hug','eat','kiss','wink','pat','happy','bully','bite','blush','wave','bath','smug','smile','highfive','handhold','cringe','bonk','cry','lick','slap','dance','cuddle']
const labels = {peek:'Espiar',comfort:'Consolar',thinkhard:'Pensar intensamente',curious:'Sentir curiosidad',sniff:'Olfatear',stare:'Mirar fijamente',trip:'Tropezar',blowkiss:'Lanzar un beso',snuggle:'Acurrucarse',angry:'Sentirse enojado',clap:'Aplaudir',coffee:'Tomar café',kisscheek:'Dar un beso en la mejilla',sing:'Cantar',tickle:'Hacer cosquillas',gaming:'Jugar videojuegos',hug:'Abrazar',kiss:'Besar',pat:'Acariciar',cry:'Llorar',dance:'Bailar',cuddle:'Acurrucarse'}

async function fetchReaction(type){
 const key=requireEvoGbApiKey();const url=new URL('/sfw/rnd/v2',process.env.EVOGB_API_BASE_URL||'https://api.evogb.org');url.searchParams.set('key',key);url.searchParams.set('type',type)
 const r=await fetch(url,{redirect:'follow',headers:{accept:'image/gif,image/*,video/*,application/json'}});const ct=(r.headers.get('content-type')||'').toLowerCase()
 if(ct.startsWith('image/')||ct.startsWith('video/'))return {buffer:Buffer.from(await r.arrayBuffer()),type:ct}
 const d=await r.json().catch(()=>({}));if(!r.ok||d.status===false)throw new Error(d.message||`HTTP ${r.status}`);return {url:d.result||d.url,type:'video/mp4'}
}
function target(ctx){const c=ctx.msg.message?.extendedTextMessage?.contextInfo||{};return c.mentionedJid?.[0]||c.participant||''}

export const animereacciones={name:'animereacciones',aliases:['areacciones'],async execute(ctx){const body=['🌸 *REACCIONES ANIME*','',...reactions.map(x=>`${config.prefix}ar ${x} — ${labels[x]||x}`)].join('\n');await ctx.sock.sendMessage(ctx.chat,{text:body},{quoted:ctx.msg})}}
export const areaccion={name:'ar',aliases:['areaccion'],async execute(ctx){const type=(ctx.args[0]||'').toLowerCase();if(!reactions.includes(type))throw new Error('Uso: .ar <tipo>. Consulta .animereacciones');const to=target(ctx);const actor=`@${ctx.sender.split('@')[0]}`;const caption=to?`🌸 ${actor} usa *${labels[type]||type}* con @${to.split('@')[0]}.`:`🌸 ${actor}: *${labels[type]||type}*.`;const media=await fetchReaction(type);const mentions=to?[ctx.sender,to]:[ctx.sender];if(media.buffer){if(media.type.startsWith('video/'))await ctx.sock.sendMessage(ctx.chat,{video:media.buffer,gifPlayback:true,caption,mentions},{quoted:ctx.msg});else await ctx.sock.sendMessage(ctx.chat,{image:media.buffer,caption,mentions},{quoted:ctx.msg})}else await ctx.sock.sendMessage(ctx.chat,{video:{url:media.url},gifPlayback:true,caption,mentions},{quoted:ctx.msg})}}
export const girls={name:'girls',aliases:['chicas'],async execute(ctx){const type=(ctx.args[0]||'random').toLowerCase();if(!['random','sexy','asian'].includes(type))throw new Error('Uso: .girls random|sexy|asian');const d=await evoGet('/sfw/girls',{type});if(!d.result)throw new Error('La API no entregó imagen.');await ctx.sock.sendMessage(ctx.chat,{image:{url:d.result},caption:`🌸 ${d.description||`Girls: ${type}`}`},{quoted:ctx.msg})}}
export const animeEvoCommands=[animereacciones,areaccion,girls]
