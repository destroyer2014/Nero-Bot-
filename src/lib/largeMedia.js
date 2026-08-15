import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import config from '../../config.js'
import { formatBytes } from './media.js'

const MB = 1024 * 1024
const partLimit = () => Math.max(20 * MB, Math.min(
  Number(process.env.LARGE_MEDIA_PART_MB || 80) * MB,
  Math.max(20 * MB, Number(config.maxUploadBytes || 90 * MB) - 5 * MB)
))
const maxSource = () => Math.max(100 * MB, Number(process.env.LARGE_MEDIA_MAX_SOURCE_MB || 1536) * MB)

function safeName(v='video') {
  return String(v || 'video').replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,' ').trim().slice(0,140) || 'video'
}

async function run(cmd,args,timeout=20*60*1000) {
  return new Promise((resolve,reject)=>{
    const p=spawn(cmd,args,{stdio:['ignore','ignore','pipe']}); let err=''
    const timer=setTimeout(()=>{p.kill('SIGKILL');reject(new Error(`${cmd} excedió el tiempo máximo.`))},timeout)
    p.stderr.on('data',c=>{err=(err+String(c)).slice(-12000)})
    p.on('error',e=>{clearTimeout(timer);reject(e)})
    p.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`${cmd} terminó con código ${code}: ${err.slice(-1200)}`))})
  })
}

async function ffmpegReady() {
  try { await run('ffmpeg',['-version'],10000); await run('ffprobe',['-version'],10000) }
  catch { throw new Error('El video necesita dividirse, pero FFmpeg/FFprobe no está disponible en el VPS.') }
}

async function durationOf(file) {
  return new Promise((resolve,reject)=>{
    const p=spawn('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file],{stdio:['ignore','pipe','pipe']})
    let out='',err=''; p.stdout.on('data',c=>out+=String(c)); p.stderr.on('data',c=>err+=String(c))
    p.on('error',reject); p.on('close',code=>{
      const n=Number(out.trim())
      if(code!==0||!Number.isFinite(n)||n<=0) reject(new Error(`No pude obtener la duración del video. ${err.slice(-500)}`))
      else resolve(n)
    })
  })
}

async function download(url,target) {
  const ctl=new AbortController()
  const timer=setTimeout(()=>ctl.abort(),Number(process.env.LARGE_MEDIA_DOWNLOAD_TIMEOUT_MS||1800000))
  try {
    const r=await fetch(url,{signal:ctl.signal,redirect:'follow',headers:{
      'user-agent':`${config.botName}/${config.version}`,
      accept:'video/mp4,video/*,application/octet-stream,*/*;q=0.8',
      'accept-encoding':'identity'
    }})
    if(!r.ok||!r.body) throw new Error(`La descarga respondió HTTP ${r.status}.`)
    const declared=Number(r.headers.get('content-length')||0)
    if(declared>maxSource()) throw new Error(`El archivo pesa ${formatBytes(declared)} y supera el máximo de descarga pesada.`)
    let received=0
    const limiter=new Transform({transform(chunk,_e,cb){
      received+=chunk.length
      received>maxSource()?cb(new Error(`La descarga superó ${formatBytes(maxSource())}.`)):cb(null,chunk)
    }})
    await pipeline(Readable.fromWeb(r.body),limiter,fs.createWriteStream(target))
    const stat=await fsp.stat(target)
    if(!stat.size) throw new Error('El archivo descargado quedó vacío.')
    return stat.size
  } catch(e) {
    if(e?.name==='AbortError') throw new Error('La descarga pesada tardó demasiado y fue cancelada.')
    throw e
  } finally { clearTimeout(timer) }
}

async function splitMp4(input,dir,maxBytes) {
  await ffmpegReady()
  const source=await fsp.stat(input)
  const duration=await durationOf(input)

  let wanted=Math.max(2,Math.ceil(source.size/(maxBytes*0.65)))
  const maxParts=Math.max(40,Math.min(160,Math.ceil(source.size/(maxBytes*0.30))))

  for(let attempt=1;attempt<=9;attempt++){
    const prefix=`part-${attempt}-`
    const pattern=path.join(dir,`${prefix}%03d.mp4`)
    const segmentSeconds=Math.max(5,duration/wanted)

    console.log('[LARGE MEDIA] split attempt',{attempt,wanted,maxParts,segmentSeconds:Math.round(segmentSeconds),sourceBytes:source.size,maxBytes})

    await run('ffmpeg',[
      '-hide_banner','-loglevel','error','-y','-i',input,
      '-map','0:v:0?','-map','0:a:0?','-c','copy','-f','segment',
      '-segment_time',String(segmentSeconds),
      '-break_non_keyframes','1','-reset_timestamps','1','-segment_format','mp4',pattern
    ],30*60*1000)

    const names=(await fsp.readdir(dir)).filter(n=>n.startsWith(prefix)&&n.endsWith('.mp4')).sort()
    const parts=[]
    let largest=0

    for(const name of names){
      const file=path.join(dir,name),st=await fsp.stat(file)
      if(!st.size)continue
      largest=Math.max(largest,st.size)
      parts.push({file,size:st.size})
    }

    if(parts.length>=2&&!parts.some(p=>p.size>maxBytes))return parts

    for(const p of parts)await fsp.rm(p.file,{force:true}).catch(()=>{})

    const ratio=largest>0?largest/maxBytes:1.5
    wanted=Math.min(maxParts,Math.max(wanted+2,Math.ceil(wanted*Math.max(1.30,ratio*1.20))))
    if(wanted>=maxParts&&attempt>=8)break
  }

  throw new Error('No pude dividir esta película dentro del límite de WhatsApp. Intenta nuevamente o usa una fuente de menor tamaño.')
}

async function sendDoc(sock,chat,file,filename,caption,quoted) {
  return sock.sendMessage(chat,{document:{url:file},mimetype:'video/mp4',fileName:filename,caption},{quoted})
}

export async function sendLargeVideoAsDocuments(sock,chat,{
  url,
  title='Video de YouTube',
  filename='',
  caption='',
  quoted,
  singleDocumentMaxBytes=0,
  splitPartBytes=0,
  silent=false
}={}) {
  if(!url) throw new Error('No existe una URL para descargar el video.')

  const dir=await fsp.mkdtemp(
    path.join(os.tmpdir(),`nero-large-${randomUUID().slice(0,8)}-`)
  )
  const clean=safeName(title)
  const source=path.join(dir,`${clean}.mp4`)
  const normalLimit=partLimit()
  const directLimit=singleDocumentMaxBytes>0
    ? singleDocumentMaxBytes
    : normalLimit
  const splitLimit=splitPartBytes>0
    ? splitPartBytes
    : normalLimit

  try {
    const bytes=await download(url,source)

    if(bytes<=directLimit){
      try {
        await sendDoc(
          sock,
          chat,
          source,
          safeName(filename||`${clean}.mp4`),
          `${caption}\n\n📦 ${formatBytes(bytes)}`,
          quoted
        )
        return {parts:1,bytes}
      } catch(error) {
        if(directLimit===normalLimit) throw error
        console.warn(
          '[LARGE MEDIA] envío único falló, usando división:',
          error?.message||error
        )
      }
    }

    const parts=await splitMp4(source,dir,splitLimit)

    if(!silent){
      await sock.sendMessage(chat,{
        text:
          `🧩 *Video dividido para WhatsApp*\n`+
          `📦 ${formatBytes(bytes)}\n`+
          `📄 Partes: ${parts.length}`
      },{quoted}).catch(()=>{})
    }

    for(let i=0;i<parts.length;i++){
      const p=parts[i]
      await sendDoc(
        sock,
        chat,
        p.file,
        safeName(`${clean} - Parte ${i+1} de ${parts.length}.mp4`),
        `🎬 *${title}*\n📄 Parte ${i+1}/${parts.length}\n📦 ${formatBytes(p.size)}`,
        i===0?quoted:undefined
      )
    }

    return {parts:parts.length,bytes}
  } finally {
    await fsp.rm(dir,{recursive:true,force:true}).catch(()=>{})
  }
}

export async function downloadLargeMediaSource(url, target) {
  if (!url) throw new Error('No existe una URL para descargar el archivo.')
  if (!target) throw new Error('No existe una ruta de destino para la descarga.')
  return download(url, target)
}

export async function sendLargeVideoFileAsDocuments(sock, chat, {
  file,
  title = 'Película',
  filename = '',
  caption = '',
  quoted,
  singleDocumentMaxBytes = 0,
  splitPartBytes = 0,
  silent = false
} = {}) {
  if (!file) throw new Error('No encontré el archivo de video extraído.')

  let stat
  try {
    stat = await fsp.stat(file)
  } catch {
    throw new Error('No encontré el archivo de video extraído.')
  }

  if (!stat.isFile() || !stat.size) {
    throw new Error('No encontré un video válido dentro del archivo de la película.')
  }

  try {
    await durationOf(file)
  } catch {
    throw new Error(
      'La fuente de esta película no contiene un video válido o está incompleta.'
    )
  }

  const clean = safeName(title)
  const normalLimit = partLimit()
  const directLimit = singleDocumentMaxBytes > 0
    ? singleDocumentMaxBytes
    : normalLimit
  const splitLimit = splitPartBytes > 0
    ? splitPartBytes
    : normalLimit

  if (stat.size <= directLimit) {
    const ext = path.extname(file) || '.mp4'

    try {
      await sock.sendMessage(chat, {
        document: { url: file },
        mimetype: ext.toLowerCase() === '.mkv'
          ? 'video/x-matroska'
          : 'video/mp4',
        fileName: safeName(filename || `${clean}${ext}`),
        caption: `${caption}\n\n📦 ${formatBytes(stat.size)}`
      }, { quoted })

      return { parts: 1, bytes: stat.size }
    } catch (error) {
      if (directLimit === normalLimit) throw error
      console.warn(
        '[MOVIE] envío como archivo único falló; usando partes:',
        error?.message || error
      )
    }
  }

  const dir = await fsp.mkdtemp(
    path.join(os.tmpdir(), `nero-split-${randomUUID().slice(0, 8)}-`)
  )

  try {
    const parts = await splitMp4(file, dir, splitLimit)

    if (!silent) {
      await sock.sendMessage(chat, {
        text:
          `🧩 *Película dividida para WhatsApp*\n` +
          `📦 ${formatBytes(stat.size)}\n` +
          `📄 Partes: ${parts.length}`
      }, { quoted }).catch(() => {})
    }

    for (let i = 0; i < parts.length; i += 1) {
      const p = parts[i]
      await sendDoc(
        sock,
        chat,
        p.file,
        safeName(`${clean} - Parte ${i + 1} de ${parts.length}.mp4`),
        [
          `🎬 *${title}*`,
          `📄 Parte ${i + 1}/${parts.length}`,
          `📦 ${formatBytes(p.size)}`,
          caption
        ].filter(Boolean).join('\n'),
        i === 0 ? quoted : undefined
      )
    }

    return { parts: parts.length, bytes: stat.size }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}