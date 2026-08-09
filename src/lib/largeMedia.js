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
  const source=await fsp.stat(input), duration=await durationOf(input)
  let wanted=Math.max(2,Math.ceil(source.size/(maxBytes*0.82)))
  for(let attempt=1;attempt<=5;attempt++){
    const prefix=`part-${attempt}-`, pattern=path.join(dir,`${prefix}%03d.mp4`)
    await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',input,
      '-map','0:v:0?','-map','0:a:0?','-c','copy','-f','segment',
      '-segment_time',String(Math.max(20,duration/wanted)),
      '-break_non_keyframes','1','-reset_timestamps','1','-segment_format','mp4',pattern])
    const names=(await fsp.readdir(dir)).filter(n=>n.startsWith(prefix)&&n.endsWith('.mp4')).sort()
    const parts=[]; let oversized=false
    for(const name of names){const file=path.join(dir,name),st=await fsp.stat(file); if(!st.size)continue; if(st.size>maxBytes)oversized=true; parts.push({file,size:st.size})}
    if(parts.length>=2&&!oversized) return parts
    for(const p of parts) await fsp.rm(p.file,{force:true}).catch(()=>{})
    wanted=Math.min(24,Math.ceil(wanted*1.5)+1)
  }
  throw new Error('No pude dividir el video en partes suficientemente pequeñas para WhatsApp.')
}

async function sendDoc(sock,chat,file,filename,caption,quoted) {
  return sock.sendMessage(chat,{document:{url:file},mimetype:'video/mp4',fileName:filename,caption},{quoted})
}

export async function sendLargeVideoAsDocuments(sock,chat,{url,title='Video de YouTube',filename='',caption='',quoted}={}) {
  if(!url) throw new Error('No existe una URL para descargar el video.')
  const dir=await fsp.mkdtemp(path.join(os.tmpdir(),`nero-large-${randomUUID().slice(0,8)}-`))
  const clean=safeName(title), source=path.join(dir,`${clean}.mp4`), limit=partLimit()
  try {
    const bytes=await download(url,source)
    if(bytes<=limit){
      await sendDoc(sock,chat,source,safeName(filename||`${clean}.mp4`),`${caption}\n\n📦 Enviado como archivo • ${formatBytes(bytes)}`,quoted)
      return {parts:1,bytes}
    }
    const parts=await splitMp4(source,dir,limit)
    await sock.sendMessage(chat,{text:`🧩 *Video dividido para WhatsApp*\n📦 ${formatBytes(bytes)}\n📄 Partes: ${parts.length}\n\nSe enviarán como archivos MP4 reproducibles.`},{quoted}).catch(()=>{})
    for(let i=0;i<parts.length;i++){
      const p=parts[i]
      await sendDoc(sock,chat,p.file,safeName(`${clean} - Parte ${i+1} de ${parts.length}.mp4`),
        `🎬 *${title}*\n📄 Parte ${i+1}/${parts.length}\n📦 ${formatBytes(p.size)}`,i===0?quoted:undefined)
    }
    return {parts:parts.length,bytes}
  } finally { await fsp.rm(dir,{recursive:true,force:true}).catch(()=>{}) }
}
