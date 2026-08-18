const { spawnSync } = require('node:child_process')

function available(command) {
  try {
    return spawnSync(command, ['--version'], {
      stdio: 'ignore',
      timeout: 5000
    }).status === 0
  } catch {
    return false
  }
}

console.log('Node:', process.version)
console.log('FFmpeg:', available('ffmpeg') ? 'OK' : 'NO')
console.log(
  'PM2:',
  available('pm2')
    ? 'OK (modo VPS)'
    : 'NO (Nero usará modo Panel/child)'
)
console.log(
  '7-Zip npm:',
  (() => {
    try {
      const sevenZip = require('7zip-bin-full')
      return sevenZip?.path7z ? 'OK' : 'NO'
    } catch {
      return 'NO'
    }
  })()
)
