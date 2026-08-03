import fs from 'node:fs'
import path from 'node:path'
const file=path.resolve('runtime','subbots.json')
function read(){try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return {}}}
let data=read()
function write(){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(data,null,2))}
export function listSubbots(){return Object.values(data)}
export function getSubbot(id){return data[id]||null}
export function upsertSubbot(item){data[item.id]={...(data[item.id]||{}),...item,updatedAt:Date.now()};write();return data[item.id]}
export function removeSubbot(id){delete data[id];write()}
