import fs from 'node:fs'
import path from 'node:path'

const file = path.resolve('runtime', 'subbots.json')
const lockFile = `${file}.lock`
const waitBuffer = new Int32Array(new SharedArrayBuffer(4))

function sleep(ms) {
  Atomics.wait(waitBuffer, 0, 0, ms)
}

function read() {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

function write(data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2))
  fs.renameSync(temporary, file)
}

function withLock(handler) {
  fs.mkdirSync(path.dirname(file), { recursive: true })

  let descriptor

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      descriptor = fs.openSync(lockFile, 'wx')
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      sleep(20)
    }
  }

  if (descriptor === undefined) {
    throw new Error('No se pudo actualizar el registro de subbots.')
  }

  try {
    return handler()
  } finally {
    fs.closeSync(descriptor)
    fs.rmSync(lockFile, { force: true })
  }
}

export function listSubbots() {
  return Object.values(read())
}

export function getSubbot(id) {
  return read()[id] || null
}

export function upsertSubbot(item) {
  return withLock(() => {
    const data = read()
    const updated = {
      ...(data[item.id] || {}),
      ...item,
      updatedAt: Date.now()
    }

    data[item.id] = updated
    write(data)
    return updated
  })
}

export function removeSubbot(id) {
  return withLock(() => {
    const data = read()
    delete data[id]
    write(data)
  })
}
