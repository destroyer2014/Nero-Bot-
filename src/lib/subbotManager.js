import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { listSubbots, upsertSubbot, removeSubbot } from './subbotRegistry.js'
export const CODE_COOLDOWN_MS=120000
const pending=new Map()

const CODE_CHARSET='0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export function generateCustomPairingCode(prefix='NERO'){
 const brand=String(prefix||'NERO').toUpperCase().replace(/[^A-Z0-9]/g,'').padEnd(4,'X').slice(0,4)
 let random=''; for(let i=0;i<4;i++) random+=CODE_CHARSET[Math.floor(Math.random()*CODE_CHARSET.length)]
 return `${brand}${random}`
}

export function canRequestCode(user){const t=pending.get(user)||0;return Math.max(0,CODE_COOLDOWN_MS-(Date.now()-t))}
export function markCodeRequest(user){pending.set(user,Date.now())}
export async function startSubbotProcess({id,phone,requestChat,requester,platform='Desconocido'}){
 const sessionDir=path.resolve('sessions','subbots',id); await fs.mkdir(sessionDir,{recursive:true})
 upsertSubbot({id,phone,requestChat,requester,platform,status:'starting',startedAt:Date.now(),sessionDir})
 const name=`nero-subbot-${id}`
 await new Promise((resolve,reject)=>{const p=spawn('pm2',['start','src/subbot-worker.js','--name',name,'--','--id',id,'--phone',phone,'--brand','NERO'],{cwd:process.cwd(),stdio:'ignore',detached:false});p.on('exit',c=>c===0?resolve():reject(new Error(`PM2 terminó con código ${c}`)));p.on('error',reject)})
 spawn('pm2',['save'],{cwd:process.cwd(),stdio:'ignore'}).unref()
 return {name,sessionDir}
}
export async function deleteSubbot(id){
 await new Promise(r=>{const p=spawn('pm2',['delete',`nero-subbot-${id}`],{stdio:'ignore'});p.on('exit',()=>r());p.on('error',()=>r())})
 await fs.rm(path.resolve('sessions','subbots',id),{recursive:true,force:true});removeSubbot(id);spawn('pm2',['save'],{stdio:'ignore'}).unref()
}
export async function restartAllSubbots(){for(const bot of listSubbots()){spawn('pm2',['restart',`nero-subbot-${bot.id}`],{stdio:'ignore'}).unref()}}
