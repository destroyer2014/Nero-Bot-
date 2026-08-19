import fs from 'node:fs'
import path from 'node:path'

const file = path.resolve('runtime', 'group-principals.json')

function load() {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2))
  fs.renameSync(temporary, file)
}

export function getGroupPrincipal(group) {
  return load()[group] || null
}

export function setGroupPrincipal(group, instanceId) {
  const data = load()
  data[group] = instanceId
  save(data)
}

export function resetGroupPrincipal(group) {
  const data = load()
  delete data[group]
  save(data)
}
