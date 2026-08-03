import { downloadMediaMessage } from '@whiskeysockets/baileys'
import { requireEvoGbApiKey } from './api.js'
import { getGroup, getWarn, setWarn } from './groupStore.js'

const mediaKinds=['imageMessage','videoMessage','stickerMessage']
const linkRegex=/(https?:\/\/|www\.|chat\.whatsapp\.com\/|wa\.me\/|t\.me\/)/i
const jidKey=value=>String(value||'').replace(/:\d+@/,'@').split('@')[0].replace(/\D/g,'')
const sameIdentity=(a,b)=>Boolean(jidKey(a)&&jidKey(a)===jidKey(b))
function valuesOf(p={}){return [p.id,p.jid,p.lid,p.phoneNumber].filter(Boolean)}
async function adminState(sock,chat,user){
 const metadata=await sock.groupMetadata(chat).catch(()=>null)
 if(!metadata)return {metadata:null,userAdmin:false,botAdmin:false}
 const userCandidates=[user].filter(Boolean)
 const botCandidates=[sock.user?.id,sock.user?.jid,sock.user?.lid].filter(Boolean)
 const find=(candidates)=>metadata.participants.find(p=>valuesOf(p).some(v=>candidates.some(c=>v===c||sameIdentity(v,c))))
 return {metadata,userAdmin:Boolean(find(userCandidates)?.admin),botAdmin:Boolean(find(botCandidates)?.admin)}
}
async function punish({sock,msg,chat,sender,reason,detail=''}){await sock.sendMessage(chat,{delete:msg.key}).catch(()=>{});const count=setWarn(chat,sender,getWarn(chat,sender)+1);const mention=`@${sender.split('@')[0]}`;if(count>=3){await sock.sendMessage(chat,{text:`🚫 *Usuario expulsado*\n\nUsuario: ${mention}\nMotivo: acumuló 3 advertencias.\nÚltima infracción: ${reason}`,mentions:[sender]});await sock.groupParticipantsUpdate(chat,[sender],'remove').catch(()=>{});setWarn(chat,sender,0)}else await sock.sendMessage(chat,{text:`⚠️ *Mensaje eliminado*\n\nUsuario: ${mention}\nMotivo: ${reason}${detail?`\n${detail}`:''}\nAdvertencias: ${count}/3`,mentions:[sender]});return true}
function scoreFromEvo(data){
 const scores=Array.isArray(data?.raw_scores)?data.raw_scores:Array.isArray(data?.scores)?data.scores:[]
 const wanted=scores.filter(x=>['porn','hentai','sexy','nsfw'].includes(String(x.className||x.label||'').toLowerCase())).map(x=>Number(x.number??x.score??(Number(x.original||0)*100))).filter(Number.isFinite)
 const direct=[data?.score,data?.nsfw_score,data?.analysis?.score,data?.result?.score].map(Number).filter(Number.isFinite)
 const all=[...wanted,...direct].map(v=>v<=1?v*100:v)
 return all.length?Math.max(...all):0
}
async function scanEvo(buffer,filename){const key=requireEvoGbApiKey();const base=process.env.EVOGB_API_BASE_URL||'https://api.evogb.org';const url=new URL('/nsfw/detect',base);url.searchParams.set('key',key);const form=new FormData();form.append('file',new Blob([buffer]),filename);const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),90000);try{const r=await fetch(url,{method:'POST',body:form,signal:controller.signal});const raw=await r.text();let d;try{d=JSON.parse(raw)}catch{throw new Error(raw.slice(0,200)||`HTTP ${r.status}`)}if(!r.ok||d.status===false)throw new Error(d.message||`HTTP ${r.status}`);return d}finally{clearTimeout(timer)}}
function quotedTarget(msg){const m=msg.message||{};const c=m.extendedTextMessage?.contextInfo||m.imageMessage?.contextInfo||m.videoMessage?.contextInfo;return c?.quotedMessage?{key:{remoteJid:msg.key.remoteJid,id:c.stanzaId,participant:c.participant},message:c.quotedMessage}:msg}
async function analyzeMessage(sock,msg){
 const target=quotedTarget(msg)
 const type=Object.keys(target.message||{}).find(x=>mediaKinds.includes(x))
 if(!type)throw new Error('Responde a una imagen, video o sticker para analizarlo.')
 const buffer=await downloadMediaMessage(target,'buffer',{}, {logger:console,reuploadRequest:sock.updateMediaMessage})
 if(!buffer?.length)throw new Error('No se pudo descargar el archivo.')
 const data=await scanEvo(buffer,type==='videoMessage'?'media.mp4':type==='stickerMessage'?'sticker.webp':'imagen.jpg')
 const score=scoreFromEvo(data)
 const flagged=Boolean(data.analysis?.is_nsfw??data.is_nsfw??data.result?.is_nsfw) || score>=70
 return {score,flagged,data}
}
export async function analyzeQuotedNsfw(ctx){return analyzeMessage(ctx.sock,ctx.msg)}
export async function moderateIncoming({sock,msg,chat,sender,isOwner,isSubOwner,text=''}){
 if(!chat?.endsWith('@g.us')||isOwner||isSubOwner)return false
 const settings=getGroup(chat);if(!settings.antiNsfw&&!settings.antiLink)return false
 const perms=await adminState(sock,chat,sender);if(perms.userAdmin||!perms.botAdmin)return false
 if(settings.antiLink&&linkRegex.test(text||''))return punish({sock,msg,chat,sender,reason:'enlace no permitido'})
 if(!settings.antiNsfw)return false
 const type=Object.keys(msg.message||{}).find(x=>mediaKinds.includes(x));if(!type)return false
 try{
   const result=await analyzeMessage(sock,msg)
   console.log('[ANTI-NSFW]',{chat,sender,score:result.score,flagged:result.flagged})
   if(settings.antiNsfwDebug){await sock.sendMessage(chat,{text:`🛡️ Imagen analizada: ${result.flagged?'NSFW':'segura'} (${result.score.toFixed(2)}%).`},{quoted:msg}).catch(()=>{})}
   if(!result.flagged)return false
   return punish({sock,msg,chat,sender,reason:'contenido NSFW',detail:`Detección: ${result.score.toFixed(2)}%`})
 }catch(error){console.warn('[ANTI-NSFW] EvoGB no respondió:',error?.message||error);return false}
}
