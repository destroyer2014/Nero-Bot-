import fs from 'node:fs/promises'
import path from 'node:path'
const dir=path.resolve('runtime','subbot-events')
export async function emitSubbotEvent(event){await fs.mkdir(dir,{recursive:true});const file=path.join(dir,`${Date.now()}-${Math.random().toString(16).slice(2)}.json`);await fs.writeFile(file,JSON.stringify(event))}
export async function consumeSubbotEvents(handler){await fs.mkdir(dir,{recursive:true});for(const name of await fs.readdir(dir)){if(!name.endsWith('.json'))continue;const file=path.join(dir,name);try{const event=JSON.parse(await fs.readFile(file,'utf8'));await handler(event);await fs.rm(file,{force:true})}catch(error){console.error('[SUBBOT EVENT]',error?.message||error)}}}
