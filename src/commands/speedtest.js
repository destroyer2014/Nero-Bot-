import fs from 'node:fs/promises'
import path from 'node:path'

const BASE = 'https://speed.cloudflare.com'
const LOCK = path.resolve('runtime', 'speedtest.lock')
const LAST = path.resolve('runtime', 'speedtest-last.json')
const COOLDOWN_MS = 60_000
const STALE_LOCK_MS = 120_000
const DOWNLOAD_BYTES = 8_000_000
const UPLOAD_BYTES = 2_000_000

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function mbps(bytes, ms) {
  if (!bytes || !ms) return 0
  return bytes * 8 / (ms / 1000) / 1_000_000
}

function jitter(values = []) {
  if (values.length < 2) return 0
  let total = 0
  for (let i = 1; i < values.length; i += 1) {
    total += Math.abs(values[i] - values[i - 1])
  }
  return total / (values.length - 1)
}

async function timedFetch(url, options = {}, timeoutMs = 25_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = performance.now()
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'cache-control': 'no-cache',
        'user-agent': 'Nero-AI-Speedtest/1.0',
        ...(options.headers || {})
      }
    })
    if (!response.ok) throw new Error(`Cloudflare respondió HTTP ${response.status}.`)
    const buffer = await response.arrayBuffer()
    return {
      ms: Math.max(1, performance.now() - start),
      bytes: buffer.byteLength
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Speedtest: la prueba tardó demasiado en responder.')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function acquireLock() {
  await fs.mkdir(path.dirname(LOCK), { recursive: true })

  try {
    const stat = await fs.stat(LOCK)
    if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
      await fs.rm(LOCK, { force: true })
    }
  } catch {}

  try {
    const handle = await fs.open(LOCK, 'wx')
    await handle.writeFile(`${process.pid}\n`)
    await handle.close()
    return true
  } catch (error) {
    if (error?.code === 'EEXIST') return false
    throw error
  }
}

async function cooldownRemaining() {
  try {
    const data = JSON.parse(await fs.readFile(LAST, 'utf8'))
    return Math.max(0, COOLDOWN_MS - (Date.now() - Number(data.at || 0)))
  } catch {
    return 0
  }
}

async function finishLock() {
  await fs.mkdir(path.dirname(LAST), { recursive: true })
  await fs.writeFile(LAST, JSON.stringify({ at: Date.now() }))
  await fs.rm(LOCK, { force: true })
}

async function latencyTest() {
  const points = []
  for (let i = 0; i < 5; i += 1) {
    const result = await timedFetch(
      `${BASE}/__down?bytes=0&cache=${Date.now()}-${i}`,
      {},
      10_000
    )
    points.push(result.ms)
    await sleep(80)
  }
  points.sort((a, b) => a - b)
  const median = points[Math.floor(points.length / 2)] || 0
  return { latency: median, jitter: jitter(points) }
}

async function downloadTest() {
  let totalBytes = 0
  let totalMs = 0
  for (let i = 0; i < 2; i += 1) {
    const bytes = Math.floor(DOWNLOAD_BYTES / 2)
    const result = await timedFetch(
      `${BASE}/__down?bytes=${bytes}&cache=${Date.now()}-${i}`,
      {},
      30_000
    )
    totalBytes += result.bytes || bytes
    totalMs += result.ms
  }
  return mbps(totalBytes, totalMs)
}

async function uploadTest() {
  const body = Buffer.alloc(UPLOAD_BYTES, 0x61)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  const start = performance.now()
  try {
    const response = await fetch(`${BASE}/__up`, {
      method: 'POST',
      body,
      signal: controller.signal,
      headers: {
        'content-type': 'application/octet-stream',
        'cache-control': 'no-cache',
        'user-agent': 'Nero-AI-Speedtest/1.0'
      }
    })
    if (!response.ok) throw new Error(`Cloudflare respondió HTTP ${response.status}.`)
    await response.arrayBuffer()
    return mbps(UPLOAD_BYTES, Math.max(1, performance.now() - start))
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Speedtest: la prueba de subida tardó demasiado.')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function meta() {
  try {
    const response = await fetch(`${BASE}/meta`, {
      headers: { 'user-agent': 'Nero-AI-Speedtest/1.0' }
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

export const speedtestCommand = {
  name: 'speedtest',
  aliases: ['speed', 'testspeed'],
  description: 'Mide la conexión del VPS usando la red de Cloudflare.',

  async execute(ctx) {
    const remaining = await cooldownRemaining()
    if (remaining > 0) {
      throw new Error(
        `Speedtest: espera ${Math.ceil(remaining / 1000)} segundos antes de ejecutar otra prueba.`
      )
    }

    const locked = await acquireLock()
    if (!locked) {
      throw new Error('Speedtest: ya hay una prueba ejecutándose en el VPS.')
    }

    await ctx.sock.sendMessage(ctx.chat, {
      text: [
        '「🚀」 *Speedtest iniciado*',
        '',
        'Midiendo la conexión del VPS...',
        'Puede tardar unos segundos.',
        '',
        '> Nero AI | © ArcadiaCorps'
      ].join('\n')
    }, { quoted: ctx.msg })

    try {
      const locationPromise = meta()
      const ping = await latencyTest()
      const download = await downloadTest()
      const upload = await uploadTest()
      const location = await locationPromise

      await ctx.sock.sendMessage(ctx.chat, {
        text: [
          '「🚀」 *Speedtest VPS*',
          '',
          `📥 Descarga: *${download.toFixed(2)} Mbps*`,
          `📤 Subida: *${upload.toFixed(2)} Mbps*`,
          `🏓 Ping: *${ping.latency.toFixed(1)} ms*`,
          `〽️ Jitter: *${ping.jitter.toFixed(1)} ms*`,
          location?.colo ? `🌐 Nodo: *Cloudflare ${location.colo}*` : '🌐 Red: *Cloudflare*',
          location?.asOrganization ? `📡 ISP/ASN: *${location.asOrganization}*` : '',
          '',
          'ℹ️ Esta prueba mide la conexión del servidor donde corre Nero, no la conexión del teléfono.',
          '',
          '> Nero AI | © ArcadiaCorps'
        ].filter(Boolean).join('\n')
      }, { quoted: ctx.msg })
    } finally {
      await finishLock().catch(() => {})
    }
  }
}
