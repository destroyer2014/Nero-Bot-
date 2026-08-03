import { downloadMediaMessage, jidNormalizedUser } from '@whiskeysockets/baileys'
import { requireEvoGbApiKey } from './api.js'
import { getGroup, getWarn, setWarn } from './groupStore.js'

const mediaKinds=['imageMessage','videoMessage','stickerMessage']
const linkRegex=/(https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/|t\.me\/)/i

async function isAdmin(sock,chat,user){const metadata=await sock.groupMetadata(chat).catch(()=>null);if(!metadata)return {metadata:null,userAdmin:false,botAdmin:false};const p=metadata.participants.find(x=>jidNormalizedUser(x.id)===jidNormalizedUser(user));const botId=jidNormalizedUser(sock.user?.id||'');const bot=metadata.participants.find(x=>jidNormalizedUser(x.id)===botId);return {metadata,userAdmin:Boolean(p?.admin),botAdmin:Boolean(bot?.admin)}}
async function punish({sock,msg,chat,sender,reason,detail=''}){await sock.sendMessage(chat,{delete:msg.key}).catch(()=>{});const count=setWarn(chat,sender,getWarn(chat,sender)+1);const mention=`@${sender.split('@')[0]}`;if(count>=3){await sock.sendMessage(chat,{text:`🚫 *Usuario expulsado*\n\nUsuario: ${mention}\nMotivo: acumuló 3 advertencias.\nÚltima infracción: ${reason}`,mentions:[sender]});await sock.groupParticipantsUpdate(chat,[sender],'remove').catch(()=>{});setWarn(chat,sender,0)}else await sock.sendMessage(chat,{text:`⚠️ *Mensaje eliminado*\n\nUsuario: ${mention}\nMotivo: ${reason}${detail?`\n${detail}`:''}\nAdvertencias: ${count}/3`,mentions:[sender]});return true}
function scoreFromEvo(data){const scores=Array.isArray(data?.raw_scores)?data.raw_scores:[];const wanted=scores.filter(x=>['porn','hentai','sexy'].includes(String(x.className||'').toLowerCase())).map(x=>Number(x.number??(Number(x.original||0)*100))).filter(Number.isFinite);return wanted.length?Math.max(...wanted):0}
async function scanEvo(buffer,filename){const key=requireEvoGbApiKey();const base=process.env.EVOGB_API_BASE_URL||'https://api.evogb.org';const url=new URL('/nsfw/detect',base);url.searchParams.set('key',key);const form=new FormData();form.append('file',new Blob([buffer]),filename);const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),90000);try{const r=await fetch(url,{method:'POST',body:form,signal:controller.signal});const raw=await r.text();let d;try{d=JSON.parse(raw)}catch{throw new Error(raw.slice(0,200)||`HTTP ${r.status}`)}if(!r.ok||d.status===false)throw new Error(d.message||`HTTP ${r.status}`);return d}finally{clearTimeout(timer)}}

export async function moderateIncoming({sock,msg,chat,sender,isOwner,isSubOwner,text=''}){
 if(!chat?.endsWith('@g.us')||isOwner||isSubOwner)return false
 const settings=getGroup(chat);if(!settings.antiNsfw&&!settings.antiLink)return false
 const perms=await isAdmin(sock,chat,sender);if(perms.userAdmin||!perms.botAdmin)return false
 if(settings.antiLink&&linkRegex.test(text||''))return punish({sock,msg,chat,sender,reason:'enlace no permitido'})
 if(!settings.antiNsfw)return false
 const type=Object.keys(msg.message||{}).find(x=>mediaKinds.includes(x));if(!type)return false
 let buffer;try{buffer=await downloadMediaMessage(msg,'buffer',{}, {logger:console,reuploadRequest:sock.updateMediaMessage})}catch{return false}
 if(!buffer)return false
 try{const data=await scanEvo(buffer,type==='videoMessage'?'media.mp4':type==='stickerMessage'?'sticker.webp':'imagen.jpg');const score=scoreFromEvo(data);const flagged=Boolean(data.analysis?.is_nsfw);if(score<70&&!flagged)return false;if(score<70)return false;return punish({sock,msg,chat,sender,reason:'contenido NSFW',detail:`Detección: ${score.toFixed(2)}%`})}catch(error){console.warn('[ANTI-NSFW] EvoGB no respondió:',error?.message||error);return false}
}
