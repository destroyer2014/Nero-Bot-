import { jidNormalizedUser, downloadMediaMessage } from '@whiskeysockets/baileys'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getGroup, patchGroup, getWarn, setWarn, resetWarn, saveTimer, clearTimer } from '../lib/groupStore.js'
import { analyzeQuotedNsfw } from '../lib/nsfwGuard.js'

function contextInfo(ctx){
  const m=ctx.msg.message||{}
  return m.extendedTextMessage?.contextInfo||m.imageMessage?.contextInfo||m.videoMessage?.contextInfo||{}
}
function targetFromMsg(ctx){
  const c=contextInfo(ctx)
  // Baileys puede entregar menciones como @lid. Ese JID es válido para
  // groupParticipantsUpdate y no debe convertirse a @s.whatsapp.net.
  return c?.mentionedJid?.[0]||c?.participant||''
}
function jidToken(value=''){
  return String(value).replace(/:\d+@/,'@').split('@')[0].split(':')[0]
}
function participantValues(p={}){
  return [p.id,p.jid,p.lid,p.phoneNumber].filter(Boolean).map(String)
}
function sameIdentity(a='',b=''){
  if(!a||!b)return false
  const na=jidNormalizedUser(String(a)), nb=jidNormalizedUser(String(b))
  return na===nb||jidToken(na)===jidToken(nb)
}
async function metadata(ctx){if(!ctx.chat.endsWith('@g.us'))throw new Error('Este comando solo funciona en grupos.');return ctx.sock.groupMetadata(ctx.chat)}
function findParticipant(meta,jid){
  return (meta.participants||[]).find(p=>participantValues(p).some(v=>sameIdentity(v,jid)))
}
async function requireAdmin(ctx){
  const m=await metadata(ctx)
  const p=findParticipant(m,ctx.sender)
  if(!p?.admin&&!ctx.isOwner&&!ctx.isSubOwner)throw new Error('Solo administradores pueden usar este comando.')
  return m
}
async function requireBotAdmin(ctx){
  const m=await requireAdmin(ctx)
  const botIds=[ctx.sock.user?.id,ctx.sock.user?.jid,ctx.sock.user?.lid].filter(Boolean)
  const bot=(m.participants||[]).find(p=>botIds.some(id=>participantValues(p).some(v=>sameIdentity(v,id))))
  if(!bot?.admin)throw new Error('El bot necesita ser administrador.')
  return m
}
const wrap=(name,aliases,fn)=>({name,aliases,async execute(ctx){try{await fn(ctx)}catch(e){await ctx.sock.sendMessage(ctx.chat,{text:`❌ ${e.message}`},{quoted:ctx.msg})}}})
function toggle(ctx,key,label){return requireAdmin(ctx).then(()=>{const value=(ctx.args[0]||'').toLowerCase();if(!['on','off'].includes(value))throw new Error(`Uso: .${ctx.text.includes(' ')?ctx.text.split(' ')[0].slice(1):key} on/off`);patchGroup(ctx.chat,{[key]:value==='on'});return ctx.sock.sendMessage(ctx.chat,{text:`✅ ${label} ${value==='on'?'activado':'desactivado'}.`},{quoted:ctx.msg})})}
function durationMs(value=''){const m=value.toLowerCase().match(/^(\d+)(s|m|h|d)$/);if(!m)return 0;const n=Number(m[1]);return n*({s:1000,m:60000,h:3600000,d:86400000}[m[2]])}
async function scheduleGroup(ctx,type){await requireBotAdmin(ctx);const ms=durationMs(ctx.args[0]);if(!ms)throw new Error(`Uso: .${type==='announcement'?'cerrargrupo':'abrirgrupo'} 30m`);const when=Date.now()+ms;saveTimer(ctx.chat,type,when);setTimeout(async()=>{await ctx.sock.groupSettingUpdate(ctx.chat,type).catch(()=>{});clearTimer(ctx.chat,type)},ms);await ctx.sock.sendMessage(ctx.chat,{text:`⏰ Grupo programado para ${type==='announcement'?'cerrarse':'abrirse'} en ${ctx.args[0]}.`},{quoted:ctx.msg})}
export const antinsfw=wrap('antinsfw',['nsfw'],async ctx=>{
  await requireAdmin(ctx)
  const action=(ctx.args[0]||'').toLowerCase()
  if(action==='test'){
    if(!ctx.isOwner)throw new Error('Este modo es exclusivo para owners.')
    const result=await analyzeQuotedNsfw(ctx)
    const label=result.flagged?'NSFW detectado':'contenido seguro'
    await ctx.sock.sendMessage(ctx.chat,{text:[
      '🛡️ *Análisis Anti-NSFW*','',
      `Resultado: *${label}*`,
      `NSFW: *${result.score.toFixed(2)}%*`,
      `Acción: ${result.flagged?'sería eliminado':'ninguna'}`,
      '',
      '> Nero Bot - Seguridad de ArcadiaCorps'
    ].join('\n')},{quoted:ctx.msg})
    return
  }
  if(action==='debug'){
    if(!ctx.isOwner)throw new Error('Este modo es exclusivo para owners.')
    const value=(ctx.args[1]||'').toLowerCase()
    if(!['on','off'].includes(value))throw new Error('Uso: .antinsfw debug on/off')
    patchGroup(ctx.chat,{antiNsfwDebug:value==='on'})
    await ctx.sock.sendMessage(ctx.chat,{text:`✅ Anti-NSFW debug ${value==='on'?'activado':'desactivado'}.`},{quoted:ctx.msg})
    return
  }
  if(!['on','off'].includes(action))throw new Error('Uso: .antinsfw on/off | .antinsfw test | .antinsfw debug on/off')
  patchGroup(ctx.chat,{antiNsfw:action==='on'})
  await ctx.sock.sendMessage(ctx.chat,{text:`✅ Anti-NSFW de EvoGB ${action==='on'?'activado':'desactivado'}.`},{quoted:ctx.msg})
})
export const antilink=wrap('antilink',[],ctx=>toggle(ctx,'antiLink','Anti-enlaces'))
export const welcome=wrap('bienvenida',['welcome'],ctx=>toggle(ctx,'welcome','Bienvenida'))
export const goodbye=wrap('despedida',['goodbye'],ctx=>toggle(ctx,'goodbye','Despedida'))
export const setwelcome=wrap('setbienvenida',[],async ctx=>{await requireAdmin(ctx);const text=ctx.args.join(' ').trim();if(!text)throw new Error('Uso: .setbienvenida <texto>');patchGroup(ctx.chat,{welcomeText:text});await ctx.sock.sendMessage(ctx.chat,{text:'✅ Mensaje de bienvenida actualizado.'},{quoted:ctx.msg})})
export const setgoodbye=wrap('setdespedida',[],async ctx=>{await requireAdmin(ctx);const text=ctx.args.join(' ').trim();if(!text)throw new Error('Uso: .setdespedida <texto>');patchGroup(ctx.chat,{goodbyeText:text});await ctx.sock.sendMessage(ctx.chat,{text:'✅ Mensaje de despedida actualizado.'},{quoted:ctx.msg})})
async function saveGroupImage(ctx,key){await requireAdmin(ctx);const m=ctx.msg.message||{};const c=m.extendedTextMessage?.contextInfo||m.imageMessage?.contextInfo;const target=c?.quotedMessage?{key:{remoteJid:ctx.msg.key.remoteJid,id:c.stanzaId,participant:c.participant},message:c.quotedMessage}:ctx.msg;let b;try{b=await downloadMediaMessage(target,'buffer',{}, {logger:console,reuploadRequest:ctx.sock.updateMediaMessage})}catch{}if(!b)throw new Error('Responde a una imagen.');const dir=path.resolve('data','group-media');await fs.mkdir(dir,{recursive:true});const file=path.join(dir,`${ctx.chat.replace(/[^a-z0-9]/gi,'_')}-${key}.jpg`);await fs.writeFile(file,b);patchGroup(ctx.chat,{[key==='welcome'?'welcomeImage':'goodbyeImage']:file});await ctx.sock.sendMessage(ctx.chat,{text:`✅ Imagen de ${key==='welcome'?'bienvenida':'despedida'} guardada.`},{quoted:ctx.msg})}
export const setwelcomeimage=wrap('setimgbienvenida',[],ctx=>saveGroupImage(ctx,'welcome'))
export const setgoodbyeimage=wrap('setimgdespedida',[],ctx=>saveGroupImage(ctx,'goodbye'))
export const setname=wrap('setname',['nombregrupo'],async ctx=>{await requireBotAdmin(ctx);const name=ctx.args.join(' ').trim();if(!name)throw new Error('Uso: .setname <nombre>');await ctx.sock.groupUpdateSubject(ctx.chat,name);await ctx.sock.sendMessage(ctx.chat,{text:'✅ Nombre del grupo actualizado.'},{quoted:ctx.msg})})
export const setdesc=wrap('setdesc',['descgrupo'],async ctx=>{await requireBotAdmin(ctx);const desc=ctx.args.join(' ').trim();if(!desc)throw new Error('Uso: .setdesc <descripción>');await ctx.sock.groupUpdateDescription(ctx.chat,desc);await ctx.sock.sendMessage(ctx.chat,{text:'✅ Descripción actualizada.'},{quoted:ctx.msg})})
export const open=wrap('abrir',['open'],async ctx=>{await requireBotAdmin(ctx);await ctx.sock.groupSettingUpdate(ctx.chat,'not_announcement');await ctx.sock.sendMessage(ctx.chat,{text:'🔓 Grupo abierto.'},{quoted:ctx.msg})})
export const close=wrap('cerrar',['close'],async ctx=>{await requireBotAdmin(ctx);await ctx.sock.groupSettingUpdate(ctx.chat,'announcement');await ctx.sock.sendMessage(ctx.chat,{text:'🔒 Grupo cerrado.'},{quoted:ctx.msg})})
export const opentimer=wrap('abrirgrupo',[],ctx=>scheduleGroup(ctx,'not_announcement'))
export const closetimer=wrap('cerrargrupo',[],ctx=>scheduleGroup(ctx,'announcement'))
export const promote=wrap('promote',['daradmin'],async ctx=>{await requireBotAdmin(ctx);const t=targetFromMsg(ctx);if(!t)throw new Error('Menciona o responde al usuario.');await ctx.sock.groupParticipantsUpdate(ctx.chat,[t],'promote');await ctx.sock.sendMessage(ctx.chat,{text:`✅ @${t.split('@')[0]} ahora es administrador.`,mentions:[t]},{quoted:ctx.msg})})
export const demote=wrap('demote',['quitaradmin'],async ctx=>{await requireBotAdmin(ctx);const t=targetFromMsg(ctx);if(!t)throw new Error('Menciona o responde al usuario.');await ctx.sock.groupParticipantsUpdate(ctx.chat,[t],'demote');await ctx.sock.sendMessage(ctx.chat,{text:`✅ Se quitó la administración a @${t.split('@')[0]}.`,mentions:[t]},{quoted:ctx.msg})})
export const kick=wrap('kick',['expulsar'],async ctx=>{await requireBotAdmin(ctx);const t=targetFromMsg(ctx);if(!t)throw new Error('Menciona o responde al usuario.');await ctx.sock.groupParticipantsUpdate(ctx.chat,[t],'remove');await ctx.sock.sendMessage(ctx.chat,{text:`✅ @${t.split('@')[0]} fue expulsado.`,mentions:[t]},{quoted:ctx.msg})})
export const warn=wrap('warn',['advertir'],async ctx=>{await requireBotAdmin(ctx);const t=targetFromMsg(ctx);if(!t)throw new Error('Menciona o responde al usuario.');const count=setWarn(ctx.chat,t,getWarn(ctx.chat,t)+1);const reason=ctx.args.filter(x=>!x.startsWith('@')).join(' ')||'Sin motivo';if(count>=3){await ctx.sock.sendMessage(ctx.chat,{text:`🚫 @${t.split('@')[0]} llegó a 3 advertencias y será expulsado.\nMotivo: ${reason}`,mentions:[t]});await ctx.sock.groupParticipantsUpdate(ctx.chat,[t],'remove');resetWarn(ctx.chat,t)}else await ctx.sock.sendMessage(ctx.chat,{text:`⚠️ @${t.split('@')[0]} recibió una advertencia (${count}/3).\nMotivo: ${reason}`,mentions:[t]},{quoted:ctx.msg})})
export const warns=wrap('warns',[],async ctx=>{await requireAdmin(ctx);const t=targetFromMsg(ctx);if(!t)throw new Error('Menciona o responde al usuario.');await ctx.sock.sendMessage(ctx.chat,{text:`⚠️ @${t.split('@')[0]} tiene ${getWarn(ctx.chat,t)}/3 advertencias.`,mentions:[t]},{quoted:ctx.msg})})
export const resetwarn=wrap('resetwarn',['unwarn'],async ctx=>{await requireAdmin(ctx);const t=targetFromMsg(ctx);if(!t)throw new Error('Menciona o responde al usuario.');resetWarn(ctx.chat,t);await ctx.sock.sendMessage(ctx.chat,{text:`✅ Advertencias reiniciadas para @${t.split('@')[0]}.`,mentions:[t]},{quoted:ctx.msg})})

async function sendGreetingPreview(ctx,kind){
  await requireAdmin(ctx)
  const settings=getGroup(ctx.chat)
  const m=await metadata(ctx)
  const participant=ctx.sender
  const isWelcome=kind==='welcome'
  const template=isWelcome?settings.welcomeText:settings.goodbyeText
  const text=String(template||'')
    .replaceAll('@user',`@${participant.split('@')[0]}`)
    .replaceAll('@group',m.subject||'el grupo')
    .replaceAll('@members',String(m.participants?.length||0))
    .replaceAll('@date',new Date().toLocaleDateString('es-PE'))
    .replaceAll('@time',new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}))
  const image=isWelcome?settings.welcomeImage:settings.goodbyeImage
  if(image){
    let media={url:image};try{media=await fs.readFile(image)}catch{}
    await ctx.sock.sendMessage(ctx.chat,{image:media,caption:text,mentions:[participant]},{quoted:ctx.msg})
  }else await ctx.sock.sendMessage(ctx.chat,{text,mentions:[participant]},{quoted:ctx.msg})
}
export const testwelcome=wrap('testwelcome',[],ctx=>{if(!ctx.isOwner)throw new Error('Este comando es exclusivo para owners.');return sendGreetingPreview(ctx,'welcome')})
export const testgoodbye=wrap('testgoodbye',[],ctx=>{if(!ctx.isOwner)throw new Error('Este comando es exclusivo para owners.');return sendGreetingPreview(ctx,'goodbye')})

export const groupconfig=wrap('groupconfig',['configgrupo'],async ctx=>{await requireAdmin(ctx);const g=getGroup(ctx.chat);await ctx.sock.sendMessage(ctx.chat,{text:`⚙️ *Configuración del grupo*\nAnti-NSFW: ${g.antiNsfw?'ON':'OFF'}\nAnti-enlaces: ${g.antiLink?'ON':'OFF'}\nBienvenida: ${g.welcome?'ON':'OFF'}\nDespedida: ${g.goodbye?'ON':'OFF'}`},{quoted:ctx.msg})})
export const tagall=wrap('tagall',[],async ctx=>{const m=await requireAdmin(ctx);const ids=m.participants.map(x=>x.id);await ctx.sock.sendMessage(ctx.chat,{text:`📢 ${ctx.args.join(' ')||'Atención a todos'}\n\n${ids.map(x=>`@${x.split('@')[0]}`).join(' ')}`,mentions:ids},{quoted:ctx.msg})})
export const hidetag=wrap('hidetag',[],async ctx=>{const m=await requireAdmin(ctx);await ctx.sock.sendMessage(ctx.chat,{text:ctx.args.join(' ')||'📢 Atención',mentions:m.participants.map(x=>x.id)},{quoted:ctx.msg})})
export const moderationCommands=[antinsfw,antilink,welcome,goodbye,setwelcome,setgoodbye,setwelcomeimage,setgoodbyeimage,setname,setdesc,open,close,opentimer,closetimer,promote,demote,kick,warn,warns,resetwarn,groupconfig,tagall,hidetag,testwelcome,testgoodbye]
