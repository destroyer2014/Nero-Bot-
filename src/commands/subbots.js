import config from '../../config.js'
import { copyButton, sendInteractive, singleSelect } from '../lib/interactive.js'
import { canRequestCode, markCodeRequest, startSubbotProcess, deleteSubbot } from '../lib/subbotManager.js'
import { setPendingSubbotPhone } from '../lib/pendingSubbotPhone.js'
import { listSubbots, getSubbot } from '../lib/subbotRegistry.js'
import { setGroupPrincipal, getGroupPrincipal, resetGroupPrincipal } from '../lib/principalStore.js'
const num=j=>String(j||'').split('@')[0].split(':')[0].replace(/\D/g,'')
const fmt=ms=>{const s=Math.max(0,Math.floor(ms/1000)),d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return `${d?d+'d ':''}${h}h ${m}m`}
export async function createSubbotForPhone(ctx, rawPhone){
 const phone=String(rawPhone||'').replace(/\D/g,'')
 if(phone.length<8||phone.length>15) throw new Error('El número debe tener entre 8 y 15 dígitos e incluir el código de país.')
 const wait=canRequestCode(ctx.sender); if(wait>0) throw new Error(`Debes esperar ${Math.ceil(wait/1000)} segundos para volver a generar un código.`)
 const id=phone; const old=getSubbot(id); if(old?.status==='connected') throw new Error('Ese número ya tiene un subbot conectado.')
 markCodeRequest(ctx.sender); await startSubbotProcess({id,phone,requestChat:ctx.chat,requester:ctx.sender})
 await ctx.sock.sendMessage(ctx.chat,{text:`⏳ *NERO está preparando el código para +${phone}.*\nPuede tardar unos segundos. Recibirás el código en este mismo chat.`},{quoted:ctx.msg})
}
export const codeCommand={name:'code',aliases:['jadibot'],async execute(ctx){
 const detected=num(ctx.sender)
 if(String(ctx.sender).endsWith('@lid')||detected.length<8||detected.length>15){
  const wait=canRequestCode(ctx.sender); if(wait>0) throw new Error(`Debes esperar ${Math.ceil(wait/1000)} segundos para volver a intentarlo.`)
  setPendingSubbotPhone(ctx.chat,ctx.sender)
  await ctx.sock.sendMessage(ctx.chat,{text:'📱 *Escribe ahora tu número real con código de país y solo dígitos.*\n\nEjemplo: *51912345678*\nTienes 2 minutos para responder.'},{quoted:ctx.msg})
  return
 }
 await createSubbotForPhone(ctx,detected)
}}
export const botsCommand={name:'bots',aliases:['subbots'],async execute(ctx){const bots=listSubbots();const online=bots.filter(b=>b.status==='connected');const lines=[`🤖 *Subbots de Nero*`,`Conectados: ${online.length}`,`Registrados: ${bots.length}`,''];for(const [i,b] of bots.entries())lines.push(`${i+1}. +${b.phone} | ${b.status||'desconocido'} | ${fmt(Date.now()-(b.connectedAt||b.startedAt||Date.now()))} | ${b.platform||'Desconocido'}`);await ctx.sock.sendMessage(ctx.chat,{text:lines.join('\n')},{quoted:ctx.msg})}}
export const setPrincipalCommand={name:'setprincipal',aliases:['setbot'],async execute(ctx){if(!ctx.chat.endsWith('@g.us'))throw new Error('Este comando solo funciona en grupos.');const bots=listSubbots().filter(b=>b.status==='connected');const all=[{id:'principal',phone:'Nero principal',status:'connected'},...bots];const rows=all.map(b=>({title:b.id==='principal'?'Nero principal':`+${b.phone}`,description:`${b.id==='principal'?'Bot principal':'Subbot'} • ${b.status}`,id:`${config.prefix}principalpick ${b.id}`}));await sendInteractive(ctx.sock,ctx.chat,{title:'Elegir bot principal',body:'Selecciona qué instancia responderá en este grupo.',buttons:[singleSelect('Seleccionar instancia',[{title:'Instancias disponibles',rows}])] },ctx.msg)}}
export const principalPickCommand={name:'principalpick',aliases:[],async execute(ctx){if(!ctx.chat.endsWith('@g.us'))return;const id=ctx.args[0];if(!id)throw new Error('Selección inválida.');setGroupPrincipal(ctx.chat,id);await ctx.sock.sendMessage(ctx.chat,{text:`✅ Instancia principal del grupo: *${id==='principal'?'Nero principal':id}*`},{quoted:ctx.msg})}}
export const principalInfoCommand={name:'principal',aliases:[],async execute(ctx){const id=getGroupPrincipal(ctx.chat)||'principal';await ctx.sock.sendMessage(ctx.chat,{text:`🤖 Principal de este grupo: *${id}*`},{quoted:ctx.msg})}}
export const resetPrincipalCommand={name:'resetprincipal',aliases:[],async execute(ctx){resetGroupPrincipal(ctx.chat);await ctx.sock.sendMessage(ctx.chat,{text:'✅ Este grupo volvió a usar Nero principal.'},{quoted:ctx.msg})}}
export const logoutSubbotCommand={name:'logout',aliases:['stopbot','delbot'],async execute(ctx){const id=num(ctx.sender);if(!getSubbot(id))throw new Error('No tienes un subbot registrado.');await ctx.sock.sendMessage(ctx.chat,{text:'🗑️ Tu sesión de subbot será eliminada del VPS.'},{quoted:ctx.msg});await deleteSubbot(id)}}
export const subbotCommands=[codeCommand,botsCommand,setPrincipalCommand,principalPickCommand,principalInfoCommand,resetPrincipalCommand,logoutSubbotCommand]
