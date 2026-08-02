import { downloadMediaMessage, jidNormalizedUser } from '@whiskeysockets/baileys'

const enabledGroups=new Set()
const warnings=new Map()
const key=(g,u)=>`${g}:${u}`
const mediaKinds=['imageMessage','videoMessage','stickerMessage']

export function setNsfw(chat,on){on?enabledGroups.add(chat):enabledGroups.delete(chat);return on}
export function isNsfwEnabled(chat){return enabledGroups.has(chat)}
export function getWarns(chat,user){return warnings.get(key(chat,user))||0}
export function resetWarns(chat,user){warnings.delete(key(chat,user))}

export async function moderateIncoming({sock,msg,chat,sender,isOwner,isSubOwner}){
 if(!chat?.endsWith('@g.us')||!enabledGroups.has(chat)||isOwner||isSubOwner)return false
 const type=Object.keys(msg.message||{}).find(x=>mediaKinds.includes(x));if(!type)return false
 const metadata=await sock.groupMetadata(chat).catch(()=>null);if(!metadata)return false
 const participant=metadata.participants.find(p=>jidNormalizedUser(p.id)===sender)
 if(participant?.admin)return false
 const botId=jidNormalizedUser(sock.user?.id||'');const bot=metadata.participants.find(p=>jidNormalizedUser(p.id)===botId)
 if(!bot?.admin)return false
 let buffer;try{buffer=await downloadMediaMessage(msg,'buffer',{}, {logger:console,reuploadRequest:sock.updateMediaMessage})}catch{return false}
 if(!buffer)return false
 const form=new FormData();form.append('file',new Blob([buffer]),type==='videoMessage'?'media.mp4':type==='stickerMessage'?'sticker.webp':'imagen.jpg')
 let data;try{const r=await fetch('https://nsfwsky.ultraplus.click/api/v1/check',{method:'POST',body:form});data=await r.json();if(!r.ok||!data.ok)return false}catch{return false}
 if(!data.is_nsfw||Number(data.nsfw_percent||data.percent||0)<70)return false
 await sock.sendMessage(chat,{delete:msg.key}).catch(()=>{})
 const count=getWarns(chat,sender)+1;warnings.set(key(chat,sender),count)
 const mention=`@${sender.split('@')[0]}`
 if(count>=3){await sock.sendMessage(chat,{text:`🚫 *Usuario expulsado*\n\nUsuario: ${mention}\nMotivo: acumuló 3 advertencias por contenido NSFW.`,mentions:[sender]});await sock.groupParticipantsUpdate(chat,[sender],'remove').catch(()=>{});warnings.delete(key(chat,sender))}
 else await sock.sendMessage(chat,{text:`⚠️ *Contenido eliminado*\n\nUsuario: ${mention}\nMotivo: contenido NSFW\nDetección: ${Number(data.nsfw_percent||data.percent).toFixed(2)}%\nAdvertencias: ${count}/3\n\nAl llegar a 3 advertencias serás expulsado del grupo.`,mentions:[sender]})
 return true
}
