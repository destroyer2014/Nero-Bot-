import 'dotenv/config'
import path from 'node:path'
import fs from 'node:fs/promises'
import pino from 'pino'
import { Boom } from '@hapi/boom'
import makeWASocket,{DisconnectReason,useMultiFileAuthState,fetchLatestBaileysVersion,makeCacheableSignalKeyStore,jidNormalizedUser} from '@itsliaaa/baileys'
import config from '../config.js'
import { extractText } from './lib/text.js'
import { findCommand } from './commands/index.js'
import { getPermissionLevel,isOwner,isSubOwner,isStaff } from './lib/permissions.js'
import { upsertSubbot,getSubbot,removeSubbot } from './lib/subbotRegistry.js'
import { getGroupPrincipal } from './lib/principalStore.js'
import { emitSubbotEvent } from './lib/subbotEvents.js'
import { getInstanceMode, privateCommandsAllowed } from './lib/modeStore.js'

const args=process.argv.slice(2);const arg=n=>{const i=args.indexOf(n);return i>=0?args[i+1]:''}
const id=arg('--id'), phone=arg('--phone')||id
if(!id||!phone) throw new Error('Faltan --id y --phone')
const logger=pino({level:process.env.BAILEYS_LOG_LEVEL||'silent'})
const sessionPath=path.resolve('sessions','subbots',id)
const clean=v=>String(v||'').replace(/\D/g,'')
const fmt=c=>c?.match(/.{1,4}/g)?.join('-')||c
async function cleanup(sock,reason='loggedOut'){
 const entry=getSubbot(id); if(entry?.requestChat) await emitSubbotEvent({type:'deleted',chat:entry.requestChat,requester:entry.requester,id,phone,reason})
 await fs.rm(sessionPath,{recursive:true,force:true});removeSubbot(id);setTimeout(()=>process.exit(0),500)
}
async function start(){
 const {state,saveCreds}=await useMultiFileAuthState(sessionPath);const fresh=!state.creds.registered
 const {version}=await fetchLatestBaileysVersion();const sock=makeWASocket({version,logger,printQRInTerminal:false,auth:{creds:state.creds,keys:makeCacheableSignalKeyStore(state.keys,logger)},browser:['NERO','Chrome','1.8.0'],markOnlineOnConnect:false,syncFullHistory:false,getMessage:async()=>undefined})
 sock.ev.on('creds.update',saveCreds)
 if(fresh){await new Promise(r=>setTimeout(r,1500));const code=await sock.requestPairingCode(clean(phone));const entry=getSubbot(id);if(entry?.requestChat)await emitSubbotEvent({type:'pairing-code',chat:entry.requestChat,requester:entry.requester,id,phone,code:fmt(code)})}
 sock.ev.on('connection.update',async u=>{const status=new Boom(u.lastDisconnect?.error)?.output?.statusCode;if(u.connection==='open'){upsertSubbot({id,phone,status:'connected',connectedAt:Date.now(),jid:sock.user?.id,platform:'Desconocido'});const e=getSubbot(id);if(e?.requestChat)await emitSubbotEvent({type:'connected',chat:e.requestChat,requester:e.requester,id,phone})}if(u.connection==='close'){if(status===DisconnectReason.loggedOut)return cleanup(sock,'sesión cerrada desde WhatsApp');setTimeout(()=>start().catch(console.error),4000)}})
 sock.ev.on('messages.upsert', async ({ messages, type }) => {
  if (type !== 'notify') return
  for (const msg of messages) {
   try {
    if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue
    const chat = msg.key.remoteJid
    const sender = jidNormalizedUser(msg.key.participant || msg.key.remoteJidAlt || msg.key.remoteJid || '')
    const text = extractText(msg.message)
    if (!text.startsWith(config.prefix)) continue

    const [raw, ...a] = text.slice(config.prefix.length).trim().split(/\s+/)
    const command = findCommand(raw)
    if (!command) continue

    const privateChat = !chat.endsWith('@g.us')
    if (privateChat && getInstanceMode('subbot', id) === 'groups' && !privateCommandsAllowed(raw)) {
      await sock.sendMessage(chat, {
        text: '🔒 *Este subbot está configurado en modo Solo grupos.*\nEste comando no está disponible en chats privados.'
      }, { quoted: msg }).catch(() => {})
      continue
    }

    if (chat.endsWith('@g.us')) {
      const chosen = getGroupPrincipal(chat) || 'principal'
      if (chosen !== id) continue
    }

    await command.execute({
      sock,
      msg,
      chat,
      sender,
      args: a,
      text,
      permissionLevel: getPermissionLevel(sender),
      isOwner: isOwner(sender),
      isSubOwner: isSubOwner(sender),
      isStaff: isStaff(sender),
      instanceType: 'subbot',
      instanceId: id
    })
   } catch (e) {
    await sock.sendMessage(msg.key.remoteJid, {
      text: `❌ Error: ${e.message}\n\nUsa *.reportar <motivo>* para reportarlo.`
    }, { quoted: msg }).catch(() => {})
   }
  }
 })
}
start().catch(e=>{console.error(e);process.exit(1)})
