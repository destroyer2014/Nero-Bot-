import os from 'node:os'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import config from '../../config.js'

const execFileAsync = promisify(execFile)

function gb(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function duration(seconds) {
  let value = Math.max(0, Math.floor(Number(seconds || 0)))
  const days = Math.floor(value / 86400)
  value %= 86400
  const hours = Math.floor(value / 3600)
  value %= 3600
  const minutes = Math.floor(value / 60)
  const secs = value % 60
  return `${days ? `${days}d ` : ''}${hours}h ${minutes}m ${secs}s`
}

function cpuSnapshot() {
  return os.cpus().map(cpu => {
    const times = cpu.times
    const total = Object.values(times).reduce((sum, n) => sum + n, 0)
    return { idle: times.idle, total }
  })
}

async function cpuUsagePercent() {
  const first = cpuSnapshot()
  await new Promise(resolve => setTimeout(resolve, 350))
  const second = cpuSnapshot()

  let idle = 0
  let total = 0

  for (let i = 0; i < Math.min(first.length, second.length); i += 1) {
    idle += second[i].idle - first[i].idle
    total += second[i].total - first[i].total
  }

  return total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : 0
}

async function disks() {
  try {
    const { stdout } = await execFileAsync('df', ['-Pk'], {
      timeout: 5000,
      maxBuffer: 1024 * 1024
    })

    const rows = stdout
      .trim()
      .split('\n')
      .slice(1)
      .map(line => line.trim().split(/\s+/))
      .filter(parts => parts.length >= 6)
      .map(parts => ({
        filesystem: parts[0],
        total: Number(parts[1]) * 1024,
        used: Number(parts[2]) * 1024,
        free: Number(parts[3]) * 1024,
        percent: parts[4],
        mount: parts.slice(5).join(' ')
      }))

    const preferred = []
    const seen = new Set()

    for (const row of rows) {
      if (!['/', '/home/container'].includes(row.mount)) continue
      const key = `${row.filesystem}:${row.mount}`
      if (seen.has(key)) continue
      seen.add(key)
      preferred.push(row)
    }

    if (!preferred.length) {
      for (const row of rows.slice(0, 3)) {
        const key = `${row.filesystem}:${row.mount}`
        if (seen.has(key)) continue
        seen.add(key)
        preferred.push(row)
      }
    }

    return preferred
  } catch {
    return []
  }
}

function packageVersion() {
  try {
    const url = new URL('../../package.json', import.meta.url)
    return JSON.parse(fs.readFileSync(url, 'utf8')).version || config.version
  } catch {
    return config.version || 'desconocida'
  }
}

export const serverCommand = {
  name: 'server',
  aliases: ['serverinfo', 'vpsinfo'],
  description: 'Muestra el estado público y sanitizado del servidor.',
  async execute(ctx) {
    const cpus = os.cpus()
    const total = os.totalmem()
    const free = os.freemem()
    const used = Math.max(0, total - free)
    const ramPercent = total ? used / total * 100 : 0
    const loads = os.loadavg()
    const usage = await cpuUsagePercent()
    const diskRows = await disks()

    const lines = [
      `🖥️ *Estado del Servidor (${config.serverLabel || 'Nero VPS'})*`,
      `🏷️ Host: ${os.hostname()}`,
      `🧩 SO: ${os.platform()} ${os.release()}`,
      `🟢 Uptime: ${duration(os.uptime())}`,
      '',
      '🧠 *RAM*',
      `• Total: ${gb(total)}`,
      `• Usada: ${gb(used)}  (${ramPercent.toFixed(1)}%)`,
      `• Libre: ${gb(free)}`,
      '',
      '⚙️ *CPU*',
      `• Modelo: ${cpus[0]?.model || 'No disponible'}`,
      `• Núcleos: ${cpus.length}`,
      `• Carga (1/5/15m): ${loads.map(n => n.toFixed(2)).join(' / ')}`,
      `• Uso aprox.: ${usage.toFixed(2)}%`,
      '',
      '💾 *Discos (df)*'
    ]

    if (diskRows.length) {
      for (const row of diskRows) {
        lines.push(`• ${row.mount} (${row.filesystem})`)
        lines.push(`  - Capacidad: ${gb(row.total)}`)
        lines.push(`  - Usado: ${gb(row.used)}  (${row.percent})`)
        lines.push(`  - Libre: ${gb(row.free)}`)
      }
    } else {
      lines.push('• Información no disponible en este entorno.')
    }

    lines.push('')
    lines.push(`🔧 Node.js: ${process.version}`)
    lines.push(`🤖 Nero: v${packageVersion()}`)

    await ctx.sock.sendMessage(
      ctx.chat,
      { text: lines.join('\n') },
      { quoted: ctx.msg }
    )
  }
}
