import fs from 'node:fs'
import path from 'node:path'
const file = path.resolve('runtime','group-principals.json')
function load(){ try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return {}} }
let data=load()
function save(){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(data,null,2)) }
export function getGroupPrincipal(group){ return data[group] || null }
export function setGroupPrincipal(group, instanceId){ data[group]=instanceId; save() }
export function resetGroupPrincipal(group){ delete data[group]; save() }
