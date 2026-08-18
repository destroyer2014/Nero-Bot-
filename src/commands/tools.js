import { downloadMediaMessage } from '@itsliaaa/baileys'
import sharp from 'sharp'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import config from '../../config.js'
import { apiGet, evoGet, requireEvoGbApiKey } from '../lib/api.js'
import { sendRemoteMedia, sendImageAlbum, formatBytes, isLikelyUrl } from '../lib/media.js'
import { getNeroTempRoot } from '../lib/diskGuard.js'

const q=ctx=>ctx.args.join(' ').trim()
const usage=(n,v)=>`Uso: *${config.prefix}${n} ${v}*`
function quotedMessage(msg){const c=msg.message?.extendedTextMessage?.contextInfo||msg.message?.imageMessage?.contextInfo||msg.message?.videoMessage?.contextInfo;return c?.quotedMessage?{key:{remoteJid:msg.key.remoteJid,id:c.stanzaId,participant:c.participant},message:c.quotedMessage}:null}
async function mediaBuffer(ctx){const target=quotedMessage(ctx.msg)||ctx.msg;try{return await downloadMediaMessage(target,'buffer',{}, {logger:console,reuploadRequest:ctx.sock.updateMediaMessage})}catch{return null}}
async function sendJsonError(ctx,error){console.error(error);await ctx.sock.sendMessage(ctx.chat,{text:`❌ ${error?.message||'No se pudo completar la herramienta.'}`},{quoted:ctx.msg})}
async function multipartEvo(endpoint,buffer,filename='archivo.bin',field='file',params={}){
 const key=requireEvoGbApiKey();const base=process.env.EVOGB_API_BASE_URL||'https://api.evogb.org';const url=new URL(endpoint,base);url.searchParams.set('key',key)
 for(const [name,value] of Object.entries(params)){if(value!==undefined&&value!==null&&value!=='')url.searchParams.set(name,String(value))}
 const form=new FormData();form.append(field,new Blob([buffer]),filename)
 const r=await fetch(url,{method:'POST',body:form})
 const contentType=(r.headers.get('content-type')||'').toLowerCase()
 if(contentType.startsWith('image/')||contentType.startsWith('video/')||contentType.startsWith('audio/')){
   if(!r.ok)throw new Error(`HTTP ${r.status}`)
   return {binary:Buffer.from(await r.arrayBuffer()),contentType}
 }
 const raw=await r.text();let data
 try{data=JSON.parse(raw)}catch{data={status:false,message:raw.slice(0,300)||`HTTP ${r.status}`}}
 if(!r.ok||data.status===false)throw new Error(data.message||data.error||`HTTP ${r.status}`);return data
}
async function evoBinaryGet(endpoint,params={}){
 const key=requireEvoGbApiKey();const base=process.env.EVOGB_API_BASE_URL||'https://api.evogb.org';const url=new URL(endpoint,base);url.searchParams.set('key',key)
 for(const [name,value] of Object.entries(params)){if(value!==undefined&&value!==null&&value!=='')url.searchParams.set(name,String(value))}
 const r=await fetch(url,{headers:{accept:'image/*,application/json;q=0.8'}})
 const type=(r.headers.get('content-type')||'').toLowerCase()
 if(type.startsWith('image/')){if(!r.ok)throw new Error(`HTTP ${r.status}`);return {binary:Buffer.from(await r.arrayBuffer()),contentType:type}}
 const raw=await r.text();let data
 try{data=JSON.parse(raw)}catch{throw new Error(raw.slice(0,300)||`HTTP ${r.status}`)}
 if(!r.ok||data.status===false)throw new Error(data.message||data.error||`HTTP ${r.status}`)
 return data
}
const wrap=(name,aliases,fn)=>({name,aliases,async execute(ctx){try{await fn(ctx)}catch(e){await sendJsonError(ctx,e)}}})

export const googleimages=wrap('googleimages',['gimage','imagenes'],async ctx=>{const term=q(ctx);if(!term)throw new Error(usage('googleimages','<búsqueda>'));const d=await apiGet('/search/google-images',{q:term,limit:10});const items=(d.results||[]).map(x=>({type:'image',download_url:x.download_url||x.image_url,title:x.title}));await sendImageAlbum(ctx.sock,ctx.chat,items,{quoted:ctx.msg,caption:`🖼️ *Google Imágenes*\nBúsqueda: ${term}\nResultados: ${items.length}\n⚠️ Verifica la licencia antes de reutilizar.`})})
export const wikipedia=wrap('wikipedia',['wiki'],async ctx=>{const term=q(ctx);if(!term)throw new Error(usage('wikipedia','<consulta>'));const d=await apiGet('/search/wikipedia',{q:term,language:'es',max_images:8});if(d.summary||d.extract){const text=`📚 *${d.title}*\n\n${(d.summary||d.extract).slice(0,3500)}\n\n${d.page_url}`;if(d.primary_image||d.original_image_url||d.thumbnail_url)await ctx.sock.sendMessage(ctx.chat,{image:{url:d.primary_image?.url||d.original_image_url||d.thumbnail_url},caption:text},{quoted:ctx.msg});else await ctx.sock.sendMessage(ctx.chat,{text},{quoted:ctx.msg});return}const rows=(d.search_results||[]).map((x,i)=>`${i+1}. *${x.title}*\n${x.snippet}\n${x.page_url}`).join('\n\n');await ctx.sock.sendMessage(ctx.chat,{text:`📚 *Resultados de Wikipedia*\n\n${rows||'Sin resultados.'}`},{quoted:ctx.msg})})
export const translate=wrap('traducir',['translate'],async ctx=>{const [to,...rest]=ctx.args;const text=rest.join(' ');if(!to||!text)throw new Error(usage('traducir','<idioma> <texto>'));const d=await evoGet('/tools/translate',{text,to});await ctx.sock.sendMessage(ctx.chat,{text:`🌐 *Traducción*\n${d.data?.detected_lang||'?'} → ${d.data?.target_lang||to}\n\n${d.data?.message||'Sin resultado'}`},{quoted:ctx.msg})})
export const qr=wrap('qr',[],async ctx=>{const text=q(ctx);if(!text)throw new Error(usage('qr','<texto o enlace>'));const d=await apiGet('/tools/qr',{mode:'link',text,size:512,foreground:'#111111',background:'#ffffff'});await sendRemoteMedia(ctx.sock,ctx.chat,d,{quoted:ctx.msg,caption:'🔳 QR generado por Nero Bot'})})
export const textimage=wrap('textoimagen',['textimg'],async ctx=>{const text=q(ctx);if(!text)throw new Error(usage('textoimagen','<texto>'));const d=await apiGet('/tools/text-image',{mode:'link',text,subtitle:'Generador por Nero Bot - ArcadiaCorps',style:'clean',width:1080,height:1080,format:'png'});await sendRemoteMedia(ctx.sock,ctx.chat,d,{quoted:ctx.msg})})
export const textgif=wrap('textogif',['textgif'],async ctx=>{const text=q(ctx);if(!text)throw new Error(usage('textogif','<texto>'));const d=await apiGet('/tools/text-gif',{mode:'link',text,subtitle:'Creado por Nero Bot - ArcadiaCorps',style:'neon',animation:'word',delay_ms:850,hold_last_ms:1400,width:720,height:720});await sendRemoteMedia(ctx.sock,ctx.chat,{...d,type:'gif'},{quoted:ctx.msg})})
export const textsticker=wrap('textosticker',['textsticker'],async ctx=>{const text=q(ctx);if(!text)throw new Error(usage('textosticker','<texto>'));const d=await apiGet('/tools/text-sticker',{mode:'link',text,style:'neon',size:512,format:'png'});await ctx.sock.sendMessage(ctx.chat,{sticker:{url:d.download_url_full||d.url}},{quoted:ctx.msg})})
export const ytthumb=wrap('ytthumb',['thumbnail'],async ctx=>{const url=q(ctx);if(!isLikelyUrl(url))throw new Error(usage('ytthumb','<url de YouTube>'));const d=await apiGet('/tools/youtube-thumbnail',{mode:'link',url,quality:'auto'});await sendRemoteMedia(ctx.sock,ctx.chat,d,{quoted:ctx.msg,caption:`🖼️ Miniatura • ${d.quality||'auto'}`})})
export const checkhost=wrap('checkhost',['host'],async ctx=>{const host=q(ctx);if(!host)throw new Error(usage('checkhost','<dominio>'));const d=await apiGet('/tools/checkhost',{host});const a=d.result?.data?.Answer||[];await ctx.sock.sendMessage(ctx.chat,{text:`🌐 *Verificación de host*\nHost: ${host}\nServicio: ${d.result?.service||'?'}\nIP: ${a.map(x=>x.data).join(', ')||'Sin respuesta'}\nTTL: ${a[0]?.TTL||'?'}`},{quoted:ctx.msg})})
export const country=wrap('pais',['country'],async ctx=>{const name=q(ctx);if(!name)throw new Error(usage('pais','<nombre>'));const d=await evoGet('/tools/country',{name,mode:'completa'});const x=d.data;const cap=x.capitals?.[0]?.name||'?';const currencies=(x.currencies||[]).map(c=>`${c.name} (${c.code})`).join(', ');const langs=(x.languages||[]).map(l=>l.native_name||l.name).join(', ');const text=`${x.flag?.emoji||'🌍'} *${x.names?.translations?.spa?.common||x.names?.common}*\nCapital: ${cap}\nRegión: ${x.region} / ${x.subregion}\nPoblación: ${Number(x.population||0).toLocaleString('es-PE')}\nÁrea: ${Number(x.area?.kilometers||0).toLocaleString('es-PE')} km²\nMoneda: ${currencies}\nIdiomas: ${langs}\nCódigo: +${(x.calling_codes||[]).join(', +')}\nZona: ${(x.timezones||[]).join(', ')}`;await ctx.sock.sendMessage(ctx.chat,{image:{url:x.flag?.url_png},caption:text},{quoted:ctx.msg})})
export const ssweb=wrap('ssweb',['screenshotweb'],async ctx=>{const url=q(ctx);if(!isLikelyUrl(url))throw new Error(usage('ssweb','<url>'));const d=await evoBinaryGet('/tools/ssweb',{url,device:'pc'});if(d.binary)return ctx.sock.sendMessage(ctx.chat,{image:d.binary,caption:'📸 Captura web'},{quoted:ctx.msg});const out=d.data?.url||d.data?.image||d.result||d.url;if(!out)throw new Error('La API no entregó la captura.');await ctx.sock.sendMessage(ctx.chat,{image:{url:out},caption:'📸 Captura web'},{quoted:ctx.msg})})
export const tempmail=wrap('tempmail',['correo'],async ctx=>{if(ctx.args[0]==='inbox'){const email=tempStore.get(ctx.sender);if(!email)throw new Error('Primero crea un correo con .tempmail');const d=await evoGet('/tools/tempmail-read',{email});const list=d.data||[];await ctx.sock.sendMessage(ctx.chat,{text:list.length?`📬 *Bandeja*\n\n${JSON.stringify(list,null,2).slice(0,3500)}`:`📭 Bandeja vacía\nCorreo: ${email}`},{quoted:ctx.msg});return}const d=await evoGet('/tools/tempmail');const email=d.data?.email;if(!email)throw new Error('No se pudo generar el correo.');tempStore.set(ctx.sender,email);await ctx.sock.sendMessage(ctx.chat,{text:`📩 *Correo temporal*\n\n${email}\n\nConsulta: .tempmail inbox`},{quoted:ctx.msg})})
const tempStore=new Map()

function findMediaUrl(value){
 if(typeof value==='string'&&/^https?:\/\//i.test(value))return value
 if(!value||typeof value!=='object')return null
 const preferred=['download_url_full','download_url','stream_url_full','stream_url','display_url','image_url','result','url','output']
 for(const key of preferred){const found=findMediaUrl(value[key]);if(found)return found}
 for(const child of Object.values(value)){const found=findMediaUrl(child);if(found)return found}
 return null
}
async function imageTool(ctx,endpoint,params={}){
 const url=ctx.args.find(isLikelyUrl)
 if(!url)throw new Error('Responde a una imagen o agrega una URL.')
 const d=await apiGet(endpoint,{mode:'link',url,...params})
 await sendRemoteMedia(ctx.sock,ctx.chat,d,{quoted:ctx.msg,caption:`✨ ${d.title||'Imagen procesada'}
${d.original_width||'?'}×${d.original_height||'?'} → ${d.width||'?'}×${d.height||'?'}
${formatBytes(d.size_bytes)}`})
}
async function enhanceImage(ctx,{scale=2}={}){
 const url=ctx.args.find(isLikelyUrl)
 if(url)return imageTool(ctx,scale>=4?'/image/upscale':'/image/hd',{scale,format:'auto'})
 const buffer=await mediaBuffer(ctx)
 if(!buffer)throw new Error(`Responde a una imagen con ${config.prefix}${scale>=4?'upscale':'hd'} o agrega una URL.`)
 await ctx.sock.sendMessage(ctx.chat,{text:`✨ Mejorando imagen en x${scale}...`},{quoted:ctx.msg})
 const d=await multipartEvo('/tools/upscale',buffer,'imagen.jpg','file',{scale})
 if(d.binary)return ctx.sock.sendMessage(ctx.chat,{image:d.binary,caption:`✨ Imagen mejorada x${scale}`},{quoted:ctx.msg})
 const output=findMediaUrl(d?.data||d)
 if(!output)throw new Error('La API procesó la imagen, pero no entregó una imagen o URL de salida.')
 await ctx.sock.sendMessage(ctx.chat,{image:{url:output},caption:`✨ Imagen mejorada x${scale}`},{quoted:ctx.msg})
}
export const hd=wrap('hd',['remini'],ctx=>enhanceImage(ctx,{scale:2}))
export const upscale=wrap('upscale',[],ctx=>enhanceImage(ctx,{scale:4}))
export const compress=wrap('comprimir',['compress'],ctx=>imageTool(ctx,'/image/compress',{quality:Number(ctx.args[0])||80,max_width:1600,format:'jpg'}))
export const restore=wrap('restaurar',['restore'],async ctx=>{const url=ctx.args.find(isLikelyUrl);if(!url)throw new Error(`Por ahora *${config.prefix}restaurar* requiere una URL pública de imagen. Ejemplo: ${config.prefix}restaurar https://...`);return imageTool(ctx,'/image/restore',{strength:'normal',scale:1,format:'auto'})})
export const convert=wrap('convertir',['imgconvert'],ctx=>{const format=ctx.args[0]||'png';return imageTool({...ctx,args:ctx.args.slice(1)},'/image/convert',{format,quality:92,max_width:1600})})

export const ocr=wrap('ocr',['leertexto'],async ctx=>{const b=await mediaBuffer(ctx);if(!b)throw new Error('Responde a una imagen con .ocr');const d=await multipartEvo('/tools/ocr',b,'imagen.jpg','file',{method:'local',model:'advanced',language:'es'});await ctx.sock.sendMessage(ctx.chat,{text:`📝 *Texto detectado*\n\n${d.result||'No se detectó texto.'}`},{quoted:ctx.msg})})
export const removebg=wrap('removebg',['quitarfondo'],async ctx=>{const b=await mediaBuffer(ctx);if(!b)throw new Error('Responde a una imagen con .removebg');const d=await multipartEvo('/tools/removebg',b,'imagen.png');const url=d.data?.url||d.result||d.url;if(!url)throw new Error('La API no entregó la imagen.');await ctx.sock.sendMessage(ctx.chat,{image:{url},caption:'🪄 Fondo eliminado'},{quoted:ctx.msg})})
export const transcribe=wrap('transcribir',['totext','audiotexto'],async ctx=>{const b=await mediaBuffer(ctx);if(!b)throw new Error('Responde a un audio o video con .transcribir');const key=process.env.DVYER_API_KEY;const url=new URL('/tools/audio-transcribe',config.apiBaseUrl);url.searchParams.set('language','auto');url.searchParams.set('apikey',key);const f=new FormData();f.append('file',new Blob([b]),'audio.mp4');const r=await fetch(url,{method:'POST',body:f});const d=await r.json();if(!r.ok||d.ok===false)throw new Error(d.message||'Falló la transcripción');await ctx.sock.sendMessage(ctx.chat,{text:`📝 *Transcripción*\nIdioma: ${d.language||'?'}\nDuración: ${d.audio?.duration_seconds||'?'} s\n\n${d.text||'Sin texto'}`},{quoted:ctx.msg})})
export const shazam=wrap('shazam',['whatmusic','quees'],async ctx=>{const b=await mediaBuffer(ctx);if(!b)throw new Error('Responde a un audio o video con .shazam');const d=await multipartEvo('/tools/whatmusic-shazam',b,'audio.mp4');const x=d.data||{};const i=x.info||{};await ctx.sock.sendMessage(ctx.chat,{image:x.media?.cover_hd?{url:x.media.cover_hd}:undefined,text:!x.media?.cover_hd?`🎵 ${i.title||'No identificada'}`:undefined,caption:x.media?.cover_hd?`🎵 *${i.title||'No identificada'}*\nArtista: ${i.artist||'?'}\nÁlbum: ${i.album||'?'}\nAño: ${i.year||'?'}\nConfianza: ${x.detection?.confidence?.percentage||'?'}%`:undefined},{quoted:ctx.msg})})
export const removevocals=wrap('quitarvoz',['removevocals','instrumental'],async ctx=>{const b=await mediaBuffer(ctx);if(!b)throw new Error('Responde a un audio con .quitarvoz');const d=await multipartEvo('/tools/remove-vocals',b,'audio.mp3');const x=d.data||{};if(!x.vocal||!x.instrumental)throw new Error('La API no devolvió ambas pistas.');await ctx.sock.sendMessage(ctx.chat,{audio:{url:x.vocal},mimetype:'audio/mpeg',fileName:'voz.mp3'},{quoted:ctx.msg});await ctx.sock.sendMessage(ctx.chat,{audio:{url:x.instrumental},mimetype:'audio/mpeg',fileName:'instrumental.mp3'})})
function messageMediaType(msg){
 const message=quotedMessage(msg)?.message||msg.message||{}
 if(message.imageMessage)return {type:'image',mimetype:message.imageMessage.mimetype||'image/jpeg'}
 if(message.stickerMessage)return {type:'sticker',mimetype:message.stickerMessage.mimetype||'image/webp'}
 if(message.videoMessage)return {type:'video',mimetype:message.videoMessage.mimetype||'video/mp4'}
 return {type:null,mimetype:null}
}
async function imageToSticker(buffer){
 try{
  return await sharp(buffer,{animated:false,failOn:'none'})
   .rotate()
   .resize(512,512,{fit:'contain',background:{r:0,g:0,b:0,alpha:0},withoutEnlargement:false})
   .webp({quality:88,alphaQuality:100,effort:4})
   .toBuffer()
 }catch(error){
  throw new Error(`No pude convertir esta imagen a sticker: ${error.message}`)
 }
}
async function runFfmpeg(args){
 return new Promise((resolve,reject)=>{
  const process=spawn('ffmpeg',args,{stdio:['ignore','ignore','pipe']})
  let stderr=''
  process.stderr.on('data',chunk=>{stderr+=chunk.toString();if(stderr.length>8000)stderr=stderr.slice(-8000)})
  process.once('error',error=>{
   if(error.code==='ENOENT')reject(new Error('FFmpeg no está instalado en el VPS. Ejecuta: apt update && apt install -y ffmpeg'))
   else reject(error)
  })
  process.once('close',code=>{
   if(code===0)resolve()
   else reject(new Error(`FFmpeg terminó con código ${code}: ${stderr.slice(-600)}`))
  })
 })
}
async function encodeVideoSticker(input,output,{fps,quality}){
 await runFfmpeg([
  '-y','-i',input,'-t','6',
  '-vf',`fps=${fps},scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
  '-an','-vcodec','libwebp','-lossless','0','-compression_level','6','-q:v',String(quality),'-loop','0',output
 ])
}
async function videoToSticker(buffer){
 const dir=await fs.mkdtemp(path.join(await getNeroTempRoot(),'nero-sticker-'))
 const input=path.join(dir,'input.mp4')
 const output=path.join(dir,'output.webp')
 try{
  await fs.writeFile(input,buffer)
  await encodeVideoSticker(input,output,{fps:15,quality:55})
  let webp=await fs.readFile(output)
  if(webp.length>1024*1024){
   await encodeVideoSticker(input,output,{fps:10,quality:38})
   webp=await fs.readFile(output)
  }
  if(!webp.length||webp.length<100)throw new Error('La conversión del video generó un archivo vacío.')
  if(webp.length>1024*1024)throw new Error('El video sigue siendo demasiado pesado para un sticker. Recórtalo o usa uno de menor resolución.')
  return webp
 }finally{
  await fs.rm(dir,{recursive:true,force:true}).catch(()=>{})
 }
}
export const sticker=wrap('sticker',['s'],async ctx=>{
 const media=messageMediaType(ctx.msg)
 const b=await mediaBuffer(ctx)
 if(!b)throw new Error('Responde a una imagen o video con .sticker o .s')
 if(!['image','sticker','video'].includes(media.type))throw new Error('Responde a una imagen, video o sticker válido.')
 let webp
 if(media.type==='video'){
  await ctx.sock.sendMessage(ctx.chat,{text:'🎞️ Convirtiendo los primeros 6 segundos del video a sticker animado...'},{quoted:ctx.msg})
  webp=await videoToSticker(b)
 }else{
  webp=media.type==='sticker'&&media.mimetype==='image/webp'?b:await imageToSticker(b)
 }
 if(!webp?.length||webp.length<100)throw new Error('La conversión generó un archivo vacío.')
 await ctx.sock.sendMessage(ctx.chat,{sticker:webp},{quoted:ctx.msg})
})

export const toolCommands=[googleimages,wikipedia,translate,qr,textimage,textgif,textsticker,ytthumb,checkhost,country,ssweb,tempmail,hd,upscale,compress,restore,convert,ocr,removebg,transcribe,shazam,removevocals,sticker]
