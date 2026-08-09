import config from '../../config.js'
import { apiGet, evoGet, ApiError } from '../lib/api.js'
import { sendInteractive, copyButton, quickReply, singleSelect, urlButton } from '../lib/interactive.js'
import { enviarCarrusel } from '../lib/uiBuilder.js'
import { formatBytes, formatDuration, isLikelyUrl, pickDownloadUrl, sendImageAlbum, sendRemoteMedia } from '../lib/media.js'
import { cancelUserJobs, clearWaitingQueues, formatQueueStatus, runDownloadJob } from '../lib/downloadQueue.js'
import { getSelection, saveSelection } from '../lib/selectionCache.js'
import sharp from 'sharp'
import Webpmux from 'node-webpmux'
import fs from 'node:fs/promises'
import path from 'node:path'

const usage = (name, value) => `Uso: *${config.prefix}${name} ${value}*`
const queryText = args => args.join(' ').trim()
const youtubeUrl = id => `https://www.youtube.com/watch?v=${id}`
const musicUrl = id => `https://music.youtube.com/watch?v=${id}`
const spotifyTrackUrl = id => `https://open.spotify.com/track/${id}`

async function fetchImageBuffer(url, timeoutMs = 20000) {
  if (!url) throw new Error('Portada no disponible.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0', accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' }
    })
    if (!response.ok) throw new Error(`Portada HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) throw new Error('La portada no es una imagen.')
    const source = Buffer.from(await response.arrayBuffer())
    if (!source.length) throw new Error('Portada vacía.')
    return sharp(source).rotate().resize(640, 640, { fit: 'cover' }).jpeg({ quality: 86 }).toBuffer()
  } finally {
    clearTimeout(timer)
  }
}

let fallbackTikTokCover
async function getFallbackTikTokCover() {
  if (!fallbackTikTokCover) {
    fallbackTikTokCover = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 20, g: 20, b: 24 } }
    }).composite([{
      input: Buffer.from(`<svg width="640" height="640" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="640" fill="#141418"/><text x="320" y="285" text-anchor="middle" fill="#ffffff" font-size="70" font-family="sans-serif" font-weight="700">TikTok</text><text x="320" y="365" text-anchor="middle" fill="#bbbbc4" font-size="34" font-family="sans-serif">Nero Bot</text></svg>`),
      top: 0,
      left: 0
    }]).jpeg({ quality: 90 }).toBuffer()
  }
  return fallbackTikTokCover
}

async function react(sock, msg, emoji) {
  await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } }).catch(() => {})
}

async function apiTask(ctx, fn) {
  await react(ctx.sock, ctx.msg, '⏳')
  try { await fn() ; await react(ctx.sock, ctx.msg, '✅') }
  catch (error) {
    console.error('Error en descarga:', error)
    const message = error instanceof ApiError ? error.message : (error?.message || 'No se pudo completar la descarga.')
    await ctx.sock.sendMessage(ctx.chat, { text: `❌ ${message}` }, { quoted: ctx.msg })
    await react(ctx.sock, ctx.msg, '❌')
  }
}

async function directMedia(ctx, endpoint, params, captionBuilder = null, options = {}) {
  const attempts = Number(options.prepareAttempts || (endpoint === '/spotify' ? 5 : 1))
  let data
  let item
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    data = await apiGet(endpoint, params, options)
    const nested = data.selected || data.result || data.primary_media || data.results?.[0] || {}
    item = { ...data, ...nested, selected: data.selected, result: data.result, results: data.results }
    if (pickDownloadUrl(item)) break
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 1800 * attempt))
  }
  const caption = captionBuilder ? captionBuilder(data, item) : `*${data.title || item.title || config.botName}*`
  await sendRemoteMedia(ctx.sock, ctx.chat, item, { quoted: ctx.msg, caption, forceDocument: options.forceDocument })
}

export const play = {
  name: 'play', aliases: ['youtube','yt'],
  async execute(ctx) { return apiTask(ctx, async () => {
    const q = queryText(ctx.args); if (!q) throw new Error(usage('play','<búsqueda>'))
    const data = await apiGet('/ytsearch', { q, limit: config.searchLimit })
    if (!data.results?.length) throw new Error('No encontré resultados en YouTube.')
    const token = saveSelection('youtube', data.results)
    const first = data.results[0]
    const rows = data.results.map((r,i)=>({ header: `Resultado ${i+1}`, title: r.title.slice(0,80), description: `${r.channel || 'YouTube'} • ${formatDuration(r.duration_seconds) || 'duración desconocida'}`, id: `${config.prefix}playpick ${token} ${i}` }))
    await sendInteractive(ctx.sock, ctx.chat, {
      title: 'YouTube Downloader', body: `Resultados para: *${q}*\nSelecciona un video.`, media: first.thumbnail ? { image: { url:first.thumbnail } } : null,
      buttons: [singleSelect('Ver resultados', [{ title:'YouTube', rows }])]
    }, ctx.msg)
  })}
}

export const playpick = { name:'playpick', aliases:[], async execute(ctx) { return apiTask(ctx, async()=>{
  const [token,indexRaw]=ctx.args; const list=getSelection(token,'youtube'); const item=list?.[Number(indexRaw)]
  if(!item) throw new Error('La selección venció. Ejecuta .play nuevamente.')
  const dur=formatDuration(item.duration_seconds)
  await sendInteractive(ctx.sock,ctx.chat,{title:'YouTube Downloader',body:[`*Título:* ${item.title}`,`*Duración:* ${dur||'No disponible'}`,`*Canal:* ${item.channel||'No disponible'}`,`*Publicado:* ${item.upload_date||'No disponible'}`,`*URL:* ${item.url}`].join('\n'),media:item.thumbnail?{image:{url:item.thumbnail}}:null,buttons:[quickReply('🎵 Audio',`${config.prefix}ytmp3 ${item.url}`),quickReply('🎬 Video',`${config.prefix}ytmp4 ${item.url}`)]},ctx.msg)
  })}}

export const ytmp3={name:'ytmp3',aliases:['ytaudio'],async execute(ctx){return apiTask(ctx,async()=>{
  const url=ctx.args[0]; if(!isLikelyUrl(url)) throw new Error(usage('ytmp3','<enlace de YouTube>'))
  await runDownloadJob(ctx,'light','.ytmp3',()=>directMedia(ctx,'/ytmp3',{mode:'link',url},(d)=>`🎵 *${d.title||'Audio de YouTube'}*\n📦 ${d.size_mb?`${d.size_mb} MB`:'Tamaño no disponible'}\n🎧 ${d.quality||'M4A'}`))
})}}
export const ytmp4={name:'ytmp4',aliases:['ytvideo'],async execute(ctx){return apiTask(ctx,async()=>{
  const url=ctx.args[0]; const quality=ctx.args[1]||'360p'; if(!isLikelyUrl(url)) throw new Error(usage('ytmp4','<enlace> [360p]'))
  await runDownloadJob(ctx,'heavy','.ytmp4',()=>directMedia(ctx,'/ytmp4',{mode:'link',url,quality},d=>`🎬 *${d.title||'Video de YouTube'}*\n📺 Calidad: ${d.quality||quality}`))
})}}

export const spotify={name:'spotify',aliases:['sp'],async execute(ctx){return apiTask(ctx,async()=>{
  const input=queryText(ctx.args); if(!input) throw new Error(usage('spotify','<nombre o enlace>'))
  if(isLikelyUrl(input)) return runDownloadJob(ctx,'light','.spotify',()=>downloadSpotifyEvo(ctx,input))
  const data=await evoGet('/search/spotify',{query:input}); const list=data.result||[]; if(!list.length) throw new Error('No encontré canciones en Spotify.')
  const token=saveSelection('spotify-evo',list); const rows=list.slice(0,10).map((r,i)=>({header:'Audio',title:`${r.artist||'Artista'} — ${r.title||'Canción'}`.slice(0,90),description:'Descargar canción',id:`${config.prefix}spotifypick ${token} ${i}`}))
  await sendInteractive(ctx.sock,ctx.chat,{title:'Spotify Downloader',body:`Resultados: *${input}*\nSelecciona una canción.`,media:list[0]?.image?{image:{url:list[0].image}}:null,buttons:[singleSelect('Seleccionar',[{title:'Canciones',rows}])]},ctx.msg)
})}}

async function downloadSpotifyEvo(ctx,url){
  const response=await evoGet('/dl/spotify',{url},{timeoutMs:180000})
  const d=response.data||{}
  if(!d.url) throw new Error('La nueva API de Spotify no entregó el audio.')
  const safeName=`${d.artist||'Spotify'} - ${d.name||'Canción'}`.replace(/[\/:*?"<>|]+/g,'_')
  await sendRemoteMedia(ctx.sock,ctx.chat,{
    type:'audio',url:d.url,download_url:d.url,mime_type:'audio/mpeg',filename:`${safeName}.mp3`
  },{quoted:ctx.msg,caption:`🎵 *${d.name||'Spotify'}*\n👤 ${d.artist||'No disponible'}\n💿 ${d.album||'No disponible'}\n⏱️ ${d.duration||'No disponible'}\n📅 ${d.year||'No disponible'}`})
}

export const spotifypick={name:'spotifypick',aliases:[],async execute(ctx){return apiTask(ctx,async()=>{
  const list=getSelection(ctx.args[0],'spotify-evo'); const item=list?.[Number(ctx.args[1])]; if(!item) throw new Error('La selección venció. Ejecuta .spotify nuevamente.')
  if(!item.link) throw new Error('El resultado elegido no contiene un enlace de Spotify.')
  await runDownloadJob(ctx,'light','.spotify',()=>downloadSpotifyEvo(ctx,item.link))
})}}

export const ytmusic={name:'ytmusic',aliases:['ytm'],async execute(ctx){return apiTask(ctx,async()=>{
  const input=queryText(ctx.args); if(!input) throw new Error(usage('ytmusic','<nombre o enlace>'))
  if(isLikelyUrl(input)) return runDownloadJob(ctx,'light','.ytmusic',()=>directMedia(ctx,'/ytmusic/download',{mode:'link',url:input},d=>`🎵 *${d.title||'YouTube Music'}*\n📦 ${d.size_mb?`${d.size_mb} MB`:d.format||'M4A'}`))
  const data=await apiGet('/ytmusic/search',{q:input,limit:10}); const list=data.results||[]; if(!list.length) throw new Error('No encontré canciones en YouTube Music.')
  const token=saveSelection('ytmusic',list); const rows=list.map((r,i)=>({header:'Audio',title:`${r.artist||'Artista'} — ${r.title}`.slice(0,90),description:`${r.album||''} ${r.duration?`• ${r.duration}`:''}`.trim(),id:`${config.prefix}ytmusicpick ${token} ${i}`}))
  await sendInteractive(ctx.sock,ctx.chat,{title:'YouTube Music',body:`Resultados: *${input}*\nSelecciona una canción.`,media:list[0]?.thumbnail?{image:{url:list[0].thumbnail}}:null,buttons:[singleSelect('Seleccionar',[{title:'Canciones',rows}])]},ctx.msg)
})}}
export const ytmusicpick={name:'ytmusicpick',aliases:[],async execute(ctx){return apiTask(ctx,async()=>{
  const list=getSelection(ctx.args[0],'ytmusic'); const item=list?.[Number(ctx.args[1])]; if(!item) throw new Error('La selección venció. Ejecuta .ytmusic nuevamente.')
  await runDownloadJob(ctx,'light','.ytmusic',()=>directMedia(ctx,'/ytmusic/download',{mode:'link',url:item.music_url||musicUrl(item.video_id)},d=>`🎵 *${d.title||item.title}*\n👤 ${item.artist||''}\n💿 ${item.album||''}`))
})}}

async function downloadAppleMusic(ctx,url){
  await directMedia(ctx,'/applemusicdl',{url},d=>[
    `🍎 *${d.track_name||d.title||'Apple Music'}*`,
    `👤 ${d.artist_name||'No disponible'}`,
    d.album_name?`💿 ${d.album_name}`:'',
    d.genre?`🎼 ${d.genre}`:'',
    d.duration_seconds?`⏱️ ${formatDuration(d.duration_seconds)}`:'',
    `🎧 ${d.quality||'128K'} • ${d.format||'MP3'}`
  ].filter(Boolean).join('\n'),{prepareAttempts:3})
}

export const applemusic={name:'applemusic',aliases:['apple','amusic'],async execute(ctx){return apiTask(ctx,async()=>{
  const input=queryText(ctx.args);if(!input)throw new Error(usage('applemusic','<nombre o enlace>'))
  if(isLikelyUrl(input))return runDownloadJob(ctx,'light','.applemusic',()=>downloadAppleMusic(ctx,input))
  const data=await apiGet('/applemusicsearch',{q:input,limit:12})
  const list=(data.results||[]).slice(0,12);if(!list.length)throw new Error('No encontré canciones en Apple Music.')
  const token=saveSelection('applemusic',list)
  const rows=list.map((r,i)=>({
    header:r.genre||'Audio',
    title:`${r.artist_name||'Artista'} — ${r.track_name||'Canción'}`.slice(0,90),
    description:[r.album_name,formatDuration(r.duration_seconds)].filter(Boolean).join(' • ').slice(0,100),
    id:`${config.prefix}applemusicpick ${token} ${i}`
  }))
  await sendInteractive(ctx.sock,ctx.chat,{
    title:'Apple Music Downloader',
    body:`Resultados: *${input}*\nSelecciona una canción.`,
    media:list[0]?.thumbnail?{image:{url:list[0].thumbnail}}:null,
    buttons:[singleSelect('Seleccionar',[{title:'Canciones',rows}])]
  },ctx.msg)
})}}

export const applemusicpick={name:'applemusicpick',aliases:[],async execute(ctx){return apiTask(ctx,async()=>{
  const list=getSelection(ctx.args[0],'applemusic');const item=list?.[Number(ctx.args[1])]
  if(!item)throw new Error('La selección venció. Ejecuta .applemusic nuevamente.')
  const url=item.song_url||item.apple_music_url
  if(!url)throw new Error('El resultado elegido no contiene un enlace de Apple Music.')
  await runDownloadJob(ctx,'light','.applemusic',()=>downloadAppleMusic(ctx,url))
})}}

async function apkSearch(ctx, mod=false){
  const q=queryText(ctx.args); if(!q) throw new Error(usage(mod?'apkmod':'apk','<nombre>'))
  const endpoint=mod?'/apkmoddl':'/apkdl'; const results=[]
  for(let pick=1;pick<=5;pick++) { try { const d=await apiGet(endpoint,mod?{q,pick}:{mode:'link',q,pick,prefer:'auto',lang:'es'}); if(d?.title&&!results.some(x=>x.title===d.title&&x.version===d.version)) results.push({...d,_searchQuery:q,_pick:pick}) } catch { break } }
  if(!results.length) throw new Error('No encontré aplicaciones.')
  const token=saveSelection(mod?'apkmod':'apk',results); const rows=results.map((r,i)=>({header:mod?'APK MOD':'APK',title:r.title.slice(0,80),description:`v${r.version||'?'} • ${r.filesize||formatBytes(r.size_bytes)}`,id:`${config.prefix}${mod?'apkmodpick':'apkpick'} ${token} ${i}`}))
  await sendInteractive(ctx.sock,ctx.chat,{title:mod?'Resultados APK MOD':'Resultados APK',body:`Búsqueda: *${q}*\nSelecciona una aplicación.`,media:results[0].icon?{image:{url:results[0].icon}}:null,buttons:[singleSelect('Ver resultados',[{title:mod?'Aplicaciones modificadas':'Aplicaciones',rows}])]},ctx.msg)
}
async function apkPick(ctx,mod=false){
  const list=getSelection(ctx.args[0],mod?'apkmod':'apk'); let d=list?.[Number(ctx.args[1])]; if(!d) throw new Error('La selección venció. Busca nuevamente.')
  const endpoint=mod?'/apkmoddl':'/apkdl'
  if(d._searchQuery&&d._pick){
    try{
      const fresh=await apiGet(endpoint,mod?{q:d._searchQuery,pick:d._pick}:{mode:'link',q:d._searchQuery,pick:d._pick,prefer:'auto',lang:'es'},{timeoutMs:180000})
      d={...d,...fresh,_searchQuery:d._searchQuery,_pick:d._pick}
    }catch(error){ console.warn('APK: no se pudo renovar el enlace:',error?.message||error) }
  }
  const size=Number(d.size_bytes||d.filesize_bytes||0); const details=[`*Título:* ${d.title}`,`*Versión:* ${d.version||'No disponible'}`,`*Formato:* ${d.format||'APK'}`,`*Tamaño:* ${size ? formatBytes(size) : (d.filesize || 'No disponible')}`,`*Android:* ${d.requirements||'No disponible'}`,`*Actualizado:* ${d.published_at||'No disponible'}`,`*Desarrollador:* ${d.developer||'No disponible'}`]
  if(mod){ if(d.mod_features?.length) details.push(`*Funciones MOD:* ${d.mod_features.join(', ')}`); if(d.mod_changes?.length) details.push(`*Cambios MOD:* ${d.mod_changes.join(', ')}`) }
  await ctx.sock.sendMessage(ctx.chat,{image:d.icon?{url:d.icon}:undefined,text:d.icon?undefined:details.join('\n'),caption:d.icon?details.join('\n'):undefined},{quoted:ctx.msg})
  await runDownloadJob(ctx,'heavy',mod?'.apkmod':'.apk',async()=>{
    let file
    let lastError
    for(let cycle=1;cycle<=4&&!file;cycle+=1){
      if(cycle>1&&d._searchQuery&&d._pick){
        try{
          const fresh=await apiGet(endpoint,mod?{q:d._searchQuery,pick:d._pick}:{mode:'link',q:d._searchQuery,pick:d._pick,prefer:'auto',lang:'es',nonce:Date.now()},{timeoutMs:180000})
          d={...d,...fresh,_searchQuery:d._searchQuery,_pick:d._pick}
        }catch(error){ lastError=error }
      }
      const urls=collectDownloadUrls(d)
      if(!urls.length) lastError=new Error('La API no entregó un enlace de descarga para el APK.')
      for(const url of urls){
        try{ file=await fetchBinaryFile(url,180000,2); break }
        catch(error){ lastError=error; console.warn(`APK: intento ${cycle} falló con ${url}:`,error?.message||error) }
      }
      if(!file&&cycle<4) await wait(1800*cycle)
    }
    if(!file){
      const reason=lastError?.message||'error desconocido'
      throw new Error(`El servidor de descarga del APK no respondió después de varios intentos (${reason}). Intenta nuevamente en unos minutos.`)
    }
    const filename=(d.filename||`${d.title||'aplicacion'}.apk`).replace(/[\/:*?"<>|]+/g,'_')
    await ctx.sock.sendMessage(ctx.chat,{
      document:file.buffer,
      mimetype:'application/vnd.android.package-archive',
      fileName:filename.toLowerCase().endsWith('.apk')?filename:`${filename}.apk`,
      caption:`${mod?'APK MOD':'APK'} • ${d.title}`
    },{quoted:ctx.msg})
  })
}
export const apk={name:'apk',aliases:['apkdl'],async execute(ctx){return apiTask(ctx,()=>apkSearch(ctx,false))}}
export const apkpick={name:'apkpick',aliases:[],async execute(ctx){return apiTask(ctx,()=>apkPick(ctx,false))}}
export const apkmod={name:'apkmod',aliases:['modapk'],async execute(ctx){return apiTask(ctx,()=>apkSearch(ctx,true))}}
export const apkmodpick={name:'apkmodpick',aliases:[],async execute(ctx){return apiTask(ctx,()=>apkPick(ctx,true))}}

function simpleLinkCommand(name,aliases,endpoint,paramsBuilder,captionBuilder,forceDocument=false,queueType='heavy'){return {name,aliases,async execute(ctx){return apiTask(ctx,async()=>{const url=ctx.args[0];if(!isLikelyUrl(url))throw new Error(usage(name,'<enlace>'));await runDownloadJob(ctx,queueType,`${config.prefix}${name}`,()=>directMedia(ctx,endpoint,paramsBuilder(url,ctx.args),captionBuilder,{forceDocument}))})}}}
export const facebook=simpleLinkCommand('facebook',['fb'],'/facebook',(url,args)=>({mode:'link',url,quality:args[1]||'auto'}),d=>`🎬 *${d.title||'Facebook Video'}*\n📺 ${d.quality||'Auto'}\n⏱️ ${d.duration||''}`)
export const instagram=simpleLinkCommand('instagram',['ig'],'/instagram',(url,args)=>({mode:'link',url,pick:args[1]||1,lang:'es'}),d=>`📸 *${d.title||'Instagram'}*\n👤 @${d.username||'usuario'}`)
export const twitch=simpleLinkCommand('twitch',['twitchdl'],'/twitch/download',url=>({url}),d=>`🎮 *${d.title||'Twitch'}*\n👤 ${d.author||''}\n⏱️ ${formatDuration(d.duration_seconds)||''}`)
export const reddit=simpleLinkCommand('reddit',['redditdl'],'/reddit/download',url=>({url}),d=>`👽 *${d.title||'Reddit'}*\n🎞️ ${d.type||'media'}`)
export const bilibili=simpleLinkCommand('bilibili',['bilidl','bili'],'/bilibili/download',url=>({url}),d=>`📺 *${d.title||'Bilibili'}*\n👤 ${d.author||''}\n⏱️ ${formatDuration(d.duration_seconds)||''}`)
export const mediafire=simpleLinkCommand('mediafire',['mf'],'/mediafire',url=>({mode:'link',url}),d=>`📁 *${d.filename||d.title}*\n📦 ${d.filesize||''}`,true)
export const mega=simpleLinkCommand('mega',['mg'],'/mega',url=>({mode:'link',url}),d=>`☁️ *${d.filename||d.title}*\n📦 ${d.filesize||formatBytes(d.filesize_bytes)}`,true)

export const threads={name:'threads',aliases:['savethreads'],async execute(ctx){return apiTask(ctx,async()=>{const url=ctx.args[0];if(!isLikelyUrl(url))throw new Error(usage('threads','<enlace>'));await runDownloadJob(ctx,'heavy','.threads',async()=>{const d=await apiGet('/savethreads',{mode:'link',url,quality:'best',pick:ctx.args[1]||1});const items=d.downloads?.length?d.downloads:[d];for(const item of items.slice(0,10))await sendRemoteMedia(ctx.sock,ctx.chat,item,{quoted:ctx.msg,caption:d.description||d.title||'Threads'})})})}}
export const universal={name:'universal',aliases:['dl'],async execute(ctx){return apiTask(ctx,async()=>{const url=ctx.args[0];if(!isLikelyUrl(url))throw new Error(usage('dl','<enlace>'));await runDownloadJob(ctx,'heavy','.dl',async()=>{const d=await apiGet('/universal',{mode:'link',url});const items=d.downloads?.length?d.downloads:(d.media?.length?d.media:[d]);for(const item of items.slice(0,10))await sendRemoteMedia(ctx.sock,ctx.chat,item,{quoted:ctx.msg,caption:d.title||`${d.platform||'Universal'}`})})})}}
export const pinterest={name:'pinterest',aliases:['pin','pindl'],async execute(ctx){return apiTask(ctx,async()=>{const input=queryText(ctx.args);if(!input)throw new Error(usage('pinterest','<enlace>'));if(!isLikelyUrl(input))throw new Error(`Para buscar usa *${config.prefix}pinterestsearch <nombre>*`);const d=await apiGet('/universal',{mode:'link',url:input});const items=d.downloads?.length?d.downloads:(d.media?.length?d.media:[d]);for(const item of items.slice(0,10))await sendRemoteMedia(ctx.sock,ctx.chat,item,{quoted:ctx.msg,caption:d.title||'Pinterest'})})}}

export const pinterestSearch={name:'pinterestsearch',aliases:['pinsearch'],async execute(ctx){return apiTask(ctx,async()=>{const input=queryText(ctx.args);if(!input)throw new Error(usage('pinterestsearch','<búsqueda>'));const response=await evoGet('/search/pinterestv3',{query:input});const list=(response.data?.images||[]).slice(0,10);if(!list.length)throw new Error('No encontré resultados en Pinterest.');const items=list.map(item=>({type:'image',title:item.title||'Pinterest',download_url:item.images?.orig||item.images?.['736x']||item.images?.['474x']||item.images?.['236x']}));await sendImageAlbum(ctx.sock,ctx.chat,items,{quoted:ctx.msg,caption:`📌 *Pinterest Search*
Búsqueda: ${input}
Resultados: ${items.length}`})})}}


export const stickerSearch={name:'stickersearch',aliases:['stickerssearch','stickerly'],async execute(ctx){return apiTask(ctx,async()=>{
  const input=queryText(ctx.args)
  if(!input)throw new Error(usage('stickersearch','<nombre>'))
  const response=await evoGet('/stickerly/search',{query:input})
  const list=(response.resultados||response.results||response.data||[]).slice(0,12)
  if(!list.length)throw new Error('No encontré paquetes de stickers.')

  const token=saveSelection('stickerly-pack',list)
  const rows=list.map((item,index)=>({
    header:item.isAnimated?'Paquete animado':'Paquete estático',
    title:(item.name||'Paquete sin nombre').slice(0,80),
    description:`${item.author||'Autor desconocido'} • ${item.stickerCount??'?'} stickers${item.isPaid?' • De pago':''}`.slice(0,100),
    id:`${config.prefix}stickerpack ${token} ${index}`
  }))

  const first=list[0]
  await sendInteractive(ctx.sock,ctx.chat,{
    title:'Sticker.ly Search',
    body:`Resultados para: *${input}*\nSelecciona un paquete para descargarlo y enviarlo.`,
    media:first?.thumbnailUrl?{image:{url:first.thumbnailUrl}}:null,
    buttons:[singleSelect('Seleccionar paquete',[{title:'Paquetes encontrados',rows}])]
  },ctx.msg)
})}}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function applyStickerPackMeta(buffer, packname, author) {
  const image = new Webpmux.Image()
  await image.load(buffer)
  const metadata = {
    'sticker-pack-id': `nero-${Date.now()}`,
    'sticker-pack-name': packname || 'Nero Bot',
    'sticker-pack-publisher': author || 'ArcadiaCorps',
    emojis: ['✨']
  }
  const exifHeader = Buffer.from([
    0x49,0x49,0x2a,0x00,0x08,0x00,0x00,0x00,0x01,0x00,0x41,0x57,
    0x07,0x00,0x00,0x00,0x00,0x00,0x16,0x00,0x00,0x00
  ])
  const json = Buffer.from(JSON.stringify(metadata), 'utf8')
  exifHeader.writeUIntLE(json.length, 14, 4)
  image.exif = Buffer.concat([exifHeader, json])
  return image.save(null)
}

function collectDownloadUrls(data = {}) {
  const keys = [
    'proxy_download_url_full', 'proxy_download_url',
    'download_url_full', 'stream_url_full', 'direct_url',
    'download_url', 'stream_url', 'url'
  ]
  const found = []
  const seenObjects = new Set()
  const seenUrls = new Set()
  const queue = [data]
  while (queue.length) {
    const value = queue.shift()
    if (!value || typeof value !== 'object' || seenObjects.has(value)) continue
    seenObjects.add(value)
    for (const key of keys) {
      const candidate = value[key]
      if (typeof candidate !== 'string' || !candidate.trim()) continue
      try {
        const absolute = new URL(candidate, config.apiBaseUrl).toString()
        if (!seenUrls.has(absolute)) { seenUrls.add(absolute); found.push(absolute) }
      } catch {}
    }
    if (Array.isArray(value)) queue.push(...value)
    else queue.push(...Object.values(value).filter(child => child && typeof child === 'object'))
  }
  return found
}

async function fetchBinaryFile(url, timeoutMs = 180000, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'user-agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36',
          accept: 'application/vnd.android.package-archive,application/octet-stream,*/*',
          'accept-encoding': 'identity'
        }
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (!buffer.length) throw new Error('Archivo vacío')
      return { buffer, contentType: response.headers.get('content-type') || '' }
    } catch (error) {
      lastError = error
      if (attempt < attempts) await wait(1200 * attempt)
    } finally { clearTimeout(timer) }
  }
  throw lastError
}

export const stickerPack={name:'stickerpack',aliases:['stickerdetail'],async execute(ctx){return apiTask(ctx,async()=>{
  const [token,indexRaw]=ctx.args
  const list=getSelection(token,'stickerly-pack')
  const selected=list?.[Number(indexRaw)]
  if(!selected)throw new Error('La selección venció. Ejecuta .stickersearch nuevamente.')
  if(!selected.url)throw new Error('El paquete elegido no incluye un enlace válido.')

  const response=await evoGet('/stickerly/detail',{url:selected.url},{timeoutMs:120000})
  const detail=response.detalles||response.details||response.data||{}
  const stickers=Array.isArray(detail.stickers)?detail.stickers.slice(0,30):[]
  const packName=detail.name||selected.name||'Sticker.ly'
  const packAuthor=detail.author?.name||detail.author?.username||selected.author||'Nero Bot'
  if(!stickers.length)throw new Error('El paquete no contiene stickers descargables.')

  await ctx.sock.sendMessage(ctx.chat,{text:[
    '⏳ *Descargando paquete de Sticker.ly*',
    `Paquete: ${packName}`,
    `Autor: ${packAuthor}`,
    `Stickers: ${stickers.length}`
  ].join('\n')},{quoted:ctx.msg})

  let sent=0
  let failed=0
  for(const item of stickers){
    try{
      if(!item.imageUrl)throw new Error('URL vacía')
      const response=await fetch(item.imageUrl,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0'}})
      if(!response.ok)throw new Error(`HTTP ${response.status}`)
      const buffer=Buffer.from(await response.arrayBuffer())
      if(!buffer.length)throw new Error('Sticker vacío')
      const stickerBuffer=await applyStickerPackMeta(buffer,packName,packAuthor)
      await ctx.sock.sendMessage(ctx.chat,{sticker:stickerBuffer},{quoted:sent===0?ctx.msg:undefined})
      sent+=1
      await wait(450)
    }catch(error){
      failed+=1
      console.error('Sticker.ly: no se pudo enviar sticker:',error?.message||error)
    }
  }

  if(!sent)throw new Error('No se pudo enviar ningún sticker del paquete.')
  await ctx.sock.sendMessage(ctx.chat,{text:`✅ *Paquete importado*\nNombre: ${packName}\nAutor: ${packAuthor}\nEnviados: ${sent}/${stickers.length}${failed?`\nFallidos: ${failed}`:''}`},{quoted:ctx.msg})
})}}


export const tiktok={name:'tiktok',aliases:['tt'],async execute(ctx){return apiTask(ctx,async()=>{const url=ctx.args[0];if(!isLikelyUrl(url))throw new Error(usage('tiktok','<enlace>'));await runDownloadJob(ctx,'heavy','.tiktok',async()=>{const response=await evoGet('/dl/tiktok',{url},{timeoutMs:180000});const d=response.data||{};if(!d.dl)throw new Error('TikTok no entregó contenido descargable.');const author=d.author?.nickname||d.author?.unique_id||'TikTok';const caption=[`${d.type==='image'?'🖼️':'🎵'} *${d.title||'TikTok'}*`,`👤 ${author}${d.author?.unique_id?` (@${d.author.unique_id})`:''}`,d.type==='image'&&Array.isArray(d.dl)?`📷 Fotos: ${d.dl.length}`:`⏱️ ${d.duration||'No disponible'}`,`🌎 ${d.region||'--'}`,d.stats?`▶️ ${d.stats.plays||0}  ❤️ ${d.stats.likes||0}  💬 ${d.stats.comments||0}`:''].filter(Boolean).join('\n');if(d.type==='image'&&Array.isArray(d.dl)){const items=d.dl.map((image,index)=>({type:'image',download_url:image,title:`TikTok foto ${index+1}`}));await sendImageAlbum(ctx.sock,ctx.chat,items,{quoted:ctx.msg,caption});return}const videoUrl=Array.isArray(d.dl)?d.dl[0]:d.dl;if(!videoUrl)throw new Error('TikTok no entregó el video.');await sendRemoteMedia(ctx.sock,ctx.chat,{type:'video',url:videoUrl,download_url:videoUrl,mime_type:'video/mp4',filename:`TikTok-${d.id||Date.now()}.mp4`},{quoted:ctx.msg,caption})})})}}

export const tiktokSearch={name:'tiktoksearch',aliases:['ttsearch','tts','tiktoks'],async execute(ctx){return apiTask(ctx,async()=>{
  const input=queryText(ctx.args)
  if(!input)throw new Error(usage('tts','<búsqueda>'))
  const response=await evoGet('/search/tiktok',{query:input})
  const list=(response.data||[]).slice(0,10)
  if(!list.length)throw new Error('No encontré resultados en TikTok.')
  const token=saveSelection('tiktok-search',list)
  const rows=list.map((item,index)=>{
    const username=item.author?.unique_id||'usuario'
    const stats=item.stats||{}
    return {
      header:`Resultado ${index+1}`,
      title:(item.title||'Sin título').slice(0,80),
      description:`@${username} • ${item.duration||'--'}s • ${stats.views||0} vistas`.slice(0,100),
      id:`${config.prefix}ttget ${token} ${index}`
    }
  })
  const first=list[0]
  await sendInteractive(ctx.sock,ctx.chat,{
    title:'TikTok Buscador',
    body:`Resultados para: *${input}*\nSelecciona un video de la lista para descargarlo.`,
    footer:'Nero Bot • ArcadiaCorps',
    media:first?.cover?{image:{url:first.cover}}:null,
    buttons:[singleSelect('Ver resultados',[{title:'Resultados de TikTok',rows}])]
  },ctx.msg)
})}}

export const tiktokGet={name:'ttget',aliases:['tiktokget','ttselect'],async execute(ctx){return apiTask(ctx,async()=>{
  let token,indexRaw
  if(ctx.args.length>=2){[token,indexRaw]=ctx.args}else{
    throw new Error('La selección venció o falta el identificador. Ejecuta .tts <búsqueda> nuevamente.')
  }
  const list=getSelection(token,'tiktok-search')
  const item=list?.[Number(indexRaw)]
  if(!item)throw new Error('La selección venció. Ejecuta .tts <búsqueda> nuevamente.')
  const username=item.author?.unique_id||'usuario'
  const original=`https://www.tiktok.com/@${username}/video/${item.id}`
  await tiktok.execute({...ctx,args:[original]})
})}}


export const testcards={name:'testcards',aliases:[],async execute(ctx){if(!ctx.isOwner)throw new Error('Este comando es exclusivo para owners.');return apiTask(ctx,async()=>{
  const imageA=await sharp({create:{width:640,height:640,channels:3,background:'#6d28d9'}}).jpeg().toBuffer()
  const imageB=await sharp({create:{width:640,height:640,channels:3,background:'#be123c'}}).jpeg().toBuffer()
  await enviarCarrusel(ctx.sock,ctx.chat,
    'Prueba exacta del carrusel de Yuta Bot.',
    'Nero Bot • ArcadiaCorps',
    [
      {img:imageA,titulo:'Tarjeta 1',body:'Código exacto de uiBuilder.js de Yuta.',footer:'Nero Bot',botones:[{tipo:'copy',texto:'Copiar',payload:'.menu'}]},
      {img:imageB,titulo:'Tarjeta 2',body:'Desliza horizontalmente para verla.',footer:'Nero Bot',botones:[{tipo:'copy',texto:'Copiar',payload:'.ping'}]}
    ],
    { quoted: null }
  )
})}}
export const testcardsbtn={name:'testcardsbtn',aliases:[],async execute(ctx){return testcards.execute(ctx)}}



export const terabox={name:'terabox',aliases:['tb'],async execute(ctx){return apiTask(ctx,async()=>{const url=ctx.args[0];if(!isLikelyUrl(url))throw new Error(usage('terabox','<enlace>'));const d=await apiGet('/terabox',{url,limit:50});const files=d.files||[];if(!files.length)throw new Error('No encontré archivos en TeraBox.');const token=saveSelection('terabox',files);const rows=files.slice(0,10).map((f,i)=>({header:'Archivo',title:f.file_name.slice(0,90),description:formatBytes(f.size_bytes),id:`${config.prefix}teraboxpick ${token} ${i}`}));await sendInteractive(ctx.sock,ctx.chat,{title:'TeraBox Downloader',body:`Se encontraron ${files.length} archivo(s).`,media:files[0].thumb?{image:{url:files[0].thumb}}:null,buttons:[singleSelect('Seleccionar',[{title:'Archivos',rows}])]},ctx.msg)})}}
export const teraboxpick={name:'teraboxpick',aliases:[],async execute(ctx){return apiTask(ctx,async()=>{const list=getSelection(ctx.args[0],'terabox');const f=list?.[Number(ctx.args[1])];if(!f)throw new Error('La selección venció.');await runDownloadJob(ctx,'heavy','.terabox',()=>sendRemoteMedia(ctx.sock,ctx.chat,{...f,type:'file',filename:f.file_name,url:f.download_url_full},{quoted:ctx.msg,caption:`TeraBox • ${f.file_name}`,forceDocument:true}))})}}

const animeAliases = {
  'rezero': 're-zero-kara-hajimeru-isekai-seikatsu',
  're-zero': 're-zero-kara-hajimeru-isekai-seikatsu',
  're-zero-kara-hajimeru': 're-zero-kara-hajimeru-isekai-seikatsu',
  'sao': 'sword-art-online'
}

function animeSlug(value) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

async function fetchAnime(name) {
  const normalized = animeSlug(name)
  const candidates = [...new Set([animeAliases[normalized], normalized].filter(Boolean))]
  let lastError
  for (const slug of candidates) {
    try { return await apiGet(`/anime/subespanol/${slug}`, { episode_limit: 50 }) }
    catch (error) {
      lastError = error
      console.warn(`Anime: falló slug ${slug}:`, error?.message || error)
    }
  }
  throw lastError || new Error('No encontré ese anime.')
}

const animeCooldown=new Map()
const ANIME_WAIT=30*60*1000

export const anime={name:'anime',aliases:['animesub'],async execute(ctx){return apiTask(ctx,async()=>{
  if(!ctx.isOwner&&!ctx.isSubOwner){const until=animeCooldown.get(ctx.sender)||0;const left=until-Date.now();if(left>0){const m=Math.floor(left/60000),sec=Math.ceil((left%60000)/1000);throw new Error(`Solo puedes iniciar 1 descarga cada 30 minutos.\nEspera: ${m} min ${sec} s`)}animeCooldown.set(ctx.sender,Date.now()+ANIME_WAIT)}
  const raw=queryText(ctx.args);if(!raw)throw new Error(usage('anime','<nombre> [episodio]'))
  const parts=raw.split(/\s+/);const episode=Number(parts.at(-1));const hasEpisode=Number.isInteger(episode)&&episode>0
  if(hasEpisode)parts.pop()
  const animeName=parts.join(' ')
  let d
  try { d=await fetchAnime(animeName) }
  catch(error){
    if([500,502,503,504].includes(error?.status)) throw new Error('El servidor de anime está temporalmente ocupado. Inténtalo nuevamente en unos minutos.')
    throw error
  }
  const info=d.anime_info||{};const chapters=(d.temporadas||[]).flatMap(t=>t.capitulos||[])
  if(!hasEpisode){
    const rows=chapters.slice(0,50).map(c=>({header:`Episodio ${c.capitulo_numero}`,title:c.titulo_capitulo||`Episodio ${c.capitulo_numero}`,description:'Descargar episodio',id:`${config.prefix}anime ${animeName} ${c.capitulo_numero}`}))
    await sendInteractive(ctx.sock,ctx.chat,{title:info.titulo||'Anime',body:`Episodios disponibles: ${chapters.length}`,media:info.imagen_portada?{image:{url:info.imagen_portada}}:null,buttons:[singleSelect('Elegir episodio',[{title:'Episodios',rows}])]},ctx.msg);return
  }
  const c=chapters.find(x=>Number(x.capitulo_numero)===episode);if(!c)throw new Error('No encontré ese episodio.')
  const downloads=(c.enlaces_descarga||[]).map(x=>x.url).filter(Boolean)
  if(!downloads.length) throw new Error('Este episodio no tiene enlaces de descarga disponibles.')
  await runDownloadJob(ctx,'heavy','.anime',async()=>{
    await ctx.sock.sendMessage(ctx.chat,{text:`📥 *Descarga iniciada*\n\nAnime: ${info.titulo||animeName}\nEpisodio: ${episode}\nEstado: preparando archivo…`},{quoted:ctx.msg})
    let resolved=null
    let source=''
    let lastError
    for(const originalUrl of downloads){
      try{
        if(/mediafire\.com/i.test(originalUrl)){
          resolved=await apiGet('/mediafire',{mode:'link',url:originalUrl},{timeoutMs:180000}); source='MediaFire'
        }else if(/mega\.nz/i.test(originalUrl)){
          const normalized=originalUrl.replace('/embed/','/file/')
          resolved=await apiGet('/mega',{mode:'link',url:normalized},{timeoutMs:180000}); source='MEGA'
        }else continue
        if(pickDownloadUrl(resolved)) break
        resolved=null
      }catch(error){ lastError=error; resolved=null }
    }
    if(!resolved) throw lastError||new Error('No pude preparar la descarga del episodio.')
    const title=info.titulo||animeName
    const filename=resolved.filename||`${title}_Episodio_${episode}.mp4`
    await ctx.sock.sendMessage(ctx.chat,{text:`🎬 *Enviando episodio, por favor espera…*\nServidor: ${source}`},{quoted:ctx.msg})
    await sendRemoteMedia(ctx.sock,ctx.chat,{...resolved,type:'video',filename,mime_type:'video/mp4'},{quoted:ctx.msg,caption:`🎬 *${title}*\nEpisodio ${episode}\nServidor: ${source}`,forceDocument:true})
  })
})}}



export const queueStatus={name:'cola',aliases:['queue'],async execute(ctx){await ctx.sock.sendMessage(ctx.chat,{text:`📥 *Estado de descargas*\n\n${formatQueueStatus()}`},{quoted:ctx.msg})}}
export const cancelDownload={name:'cancelardescarga',aliases:['cancelardl'],async execute(ctx){const removed=cancelUserJobs(ctx.sender);await ctx.sock.sendMessage(ctx.chat,{text:removed?`✅ Se cancelaron ${removed} descarga(s) tuyas en espera.`:'No tienes descargas esperando en la cola.'},{quoted:ctx.msg})}}
export const clearQueue={name:'limpiarcola',aliases:['clearqueue'],async execute(ctx){if(!ctx.isStaff)throw new Error('Este comando es solo para owner y subowner.');const removed=clearWaitingQueues();await ctx.sock.sendMessage(ctx.chat,{text:`✅ Cola limpiada. Solicitudes eliminadas: ${removed}.`},{quoted:ctx.msg})}}

export const downloadCommands=[play,playpick,ytmp3,ytmp4,spotify,spotifypick,ytmusic,ytmusicpick,applemusic,applemusicpick,apk,apkpick,apkmod,apkmodpick,facebook,instagram,twitch,reddit,bilibili,threads,universal,pinterest,pinterestSearch,stickerSearch,stickerPack,tiktok,tiktokSearch,tiktokGet,mediafire,mega,terabox,teraboxpick,anime,queueStatus,cancelDownload,clearQueue]
