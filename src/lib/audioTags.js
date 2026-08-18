import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import sharp from 'sharp'

const MAX_AUDIO_BYTES = Math.max(
  20,
  Number(process.env.TAGGED_AUDIO_MAX_MB || 180)
) * 1024 * 1024

function safeText(value = '', fallback = '') {
  const text = String(value || '')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text || fallback
}

function safeFilename(value = 'Nero Audio.mp3') {
  const cleaned = safeText(value, 'Nero Audio.mp3')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\.(m4a|mp4|aac|ogg|opus|webm)$/i, '')
    .slice(0, 145)

  return cleaned.toLowerCase().endsWith('.mp3')
    ? cleaned
    : `${cleaned}.mp3`
}

async function fetchBuffer(url, {
  timeoutMs = 180000,
  maxBytes = MAX_AUDIO_BYTES,
  accept = '*/*'
} = {}) {
  if (!url) throw new Error('Falta la URL del archivo.')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        accept,
        'user-agent': 'NeroBot/AudioTags'
      }
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const declared = Number(response.headers.get('content-length') || 0)
    if (declared > maxBytes) {
      throw new Error('El audio supera el límite de procesamiento de metadata.')
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (!buffer.length) throw new Error('El servidor devolvió un archivo vacío.')
    if (buffer.length > maxBytes) {
      throw new Error('El audio supera el límite de procesamiento de metadata.')
    }

    return buffer
  } finally {
    clearTimeout(timer)
  }
}

function runFfmpeg(args, timeoutMs = 7 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe']
    })

    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      child.kill('SIGKILL')
      settled = true
      reject(new Error('FFmpeg tardó demasiado procesando el audio.'))
    }, timeoutMs)

    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
      if (stderr.length > 12000) stderr = stderr.slice(-12000)
    })

    child.once('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error?.code === 'ENOENT') {
        reject(new Error('FFmpeg no está disponible en el VPS.'))
      } else {
        reject(error)
      }
    })

    child.once('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)

      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(
        stderr.trim().split('\n').slice(-6).join(' ') ||
        `FFmpeg terminó con código ${code}`
      ))
    })
  })
}

export async function createTaggedAudio({
  audioUrl,
  title = 'Audio',
  artist = 'Nero',
  album = '',
  year = '',
  coverUrl = '',
  filename = ''
} = {}) {
  if (!audioUrl) throw new Error('No hay un enlace de audio para procesar.')

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nero-audio-'))
  const source = path.join(dir, 'source.bin')
  const cover = path.join(dir, 'cover.jpg')
  const output = path.join(dir, 'tagged.mp3')

  const cleanup = async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  try {
    const audio = await fetchBuffer(audioUrl)
    await fs.writeFile(source, audio)

    let hasCover = false
    let coverBuffer = null

    if (coverUrl) {
      try {
        const rawCover = await fetchBuffer(coverUrl, {
          timeoutMs: 30000,
          maxBytes: 8 * 1024 * 1024,
          accept: 'image/*,*/*;q=0.8'
        })

        coverBuffer = await sharp(rawCover)
          .rotate()
          .resize(1200, 1200, {
            fit: 'cover',
            withoutEnlargement: true
          })
          .jpeg({ quality: 90 })
          .toBuffer()

        await fs.writeFile(cover, coverBuffer)
        hasCover = true
      } catch (error) {
        console.warn(
          '[AUDIO TAGS] portada omitida:',
          error?.message || error
        )
      }
    }

    const finalTitle = safeText(title, 'Audio')
    const finalArtist = safeText(artist, 'Nero')
    const finalAlbum = safeText(album)
    const finalYear = safeText(year)

    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', source
    ]

    if (hasCover) {
      args.push(
        '-i', cover,
        '-map', '0:a:0',
        '-map', '1:v:0'
      )
    } else {
      args.push('-map', '0:a:0')
    }

    args.push(
      '-c:a', 'libmp3lame',
      '-q:a', '2',
      '-id3v2_version', '3',
      '-metadata', `title=${finalTitle}`,
      '-metadata', `artist=${finalArtist}`
    )

    if (finalAlbum) args.push('-metadata', `album=${finalAlbum}`)
    if (finalYear) args.push('-metadata', `date=${finalYear}`)

    if (hasCover) {
      args.push(
        '-c:v', 'mjpeg',
        '-metadata:s:v', 'title=Album cover',
        '-metadata:s:v', 'comment=Cover (front)',
        '-disposition:v:0', 'attached_pic'
      )
    }

    args.push(output)

    await runFfmpeg(args)

    const stat = await fs.stat(output)
    if (!stat.size) throw new Error('FFmpeg generó un audio vacío.')

    return {
      file: output,
      filename: safeFilename(
        filename || `${finalArtist} - ${finalTitle}.mp3`
      ),
      mimetype: 'audio/mpeg',
      bytes: stat.size,
      title: finalTitle,
      artist: finalArtist,
      album: finalAlbum,
      coverEmbedded: hasCover,
      coverBuffer,
      cleanup
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}

export async function sendTaggedAudio(sock, chat, options = {}) {
  const tagged = await createTaggedAudio(options)

  try {
    await sock.sendMessage(
      chat,
      {
        audio: { url: tagged.file },
        mimetype: tagged.mimetype,
        fileName: tagged.filename,
        ptt: false
      },
      { quoted: options.quoted }
    )

    return {
      bytes: tagged.bytes,
      title: tagged.title,
      artist: tagged.artist,
      album: tagged.album,
      coverEmbedded: tagged.coverEmbedded
    }
  } finally {
    await tagged.cleanup()
  }
}
