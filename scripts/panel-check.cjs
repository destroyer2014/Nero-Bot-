const {
  spawnSync
} = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

function available(command, args) {
  try {
    return spawnSync(command, args, {
      stdio: 'ignore',
      timeout: 5000
    }).status === 0
  } catch {
    return false
  }
}

const tempRoot = path.resolve(
  process.env.NERO_TMP_DIR || 'tmp/runtime'
)

try {
  fs.mkdirSync(tempRoot, { recursive: true })
} catch {}

console.log('Node:', process.version)
console.log(
  'FFmpeg:',
  available('ffmpeg', ['-version']) ? 'OK' : 'NO'
)
console.log(
  'FFprobe:',
  available('ffprobe', ['-version']) ? 'OK' : 'NO'
)
console.log(
  'PM2:',
  available('pm2', ['--version'])
    ? 'OK (modo VPS)'
    : 'NO (Nero usará modo Panel/child)'
)
console.log(
  '7-Zip npm:',
  (() => {
    try {
      const sevenZip = require('7zip-bin-full')
      const bin = sevenZip?.path7z
      if (!bin) return 'NO'
      return fs.existsSync(bin) ? 'OK' : 'NO'
    } catch {
      return 'NO'
    }
  })()
)
console.log('Temp Nero:', tempRoot)
console.log(
  'Delay comandos:',
  `${Number(process.env.COMMAND_RESPONSE_DELAY_MS || 5000)} ms`
)
console.log(
  'Reserva disco:',
  `${Number(process.env.NERO_DISK_RESERVE_MB || 1024)} MB`
)
