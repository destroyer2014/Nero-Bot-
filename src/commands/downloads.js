import config from '../../config.js'
import { apiGet, evoGet, ApiError } from '../lib/api.js'
import { sendInteractive, sendCarousel, copyButton, quickReply, singleSelect, urlButton } from '../lib/interactive.js'
import { formatBytes, formatDuration, isLikelyUrl, pickDownloadUrl, sendImageAlbum, sendRemoteMedia } from '../lib/media.js'
import { cancelUserJobs, clearWaitingQueues, formatQueueStatus, runDownloadJob } from '../lib/downloadQueue.js'
import { getSelection, saveSelection } from '../lib/selectionCache.js'

const usage = (name, value) => `Uso: *${config.prefix}${name} ${value}*`
const queryText = args => args.join(' ').trim()
const youtubeUrl = id => `https://www.youtube.com/watch?v=${id}`
const musicUrl = id => `https://music.youtube.com/watch?v=${id}`
const spotifyTrackUrl = id => `https://open.spotify.com/track/${id}`

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

async function apkSearch(ctx, mod=false){
  const q=queryText(ctx.args); if(!q) throw new Error(usage(mod?'apkmod':'apk','<nombre>'))
  const endpoint=mod?'/apkmoddl':'/apkdl'; const results=[]
  for(let pick=1;pick<=5;pick++) { try { const d=await apiGet(endpoint,mod?{q,pick}:{mode:'link',q,pick,prefer:'auto',lang:'es'}); if(d?.title&&!results.some(x=>x.title===d.title&&x.version===d.version)) results.push(d) } catch { break } }
  if(!results.length) throw new Error('No encontré aplicaciones.')
  const token=saveSelection(mod?'apkmod':'apk',results); const rows=results.map((r,i)=>({header:mod?'APK MOD':'APK',title:r.title.slice(0,80),description:`v${r.version||'?'} • ${r.filesize||formatBytes(r.size_bytes)}`,id:`${config.prefix}${mod?'apkmodpick':'apkpick'} ${token} ${i}`}))
  await sendInteractive(ctx.sock,ctx.chat,{title:mod?'Resultados APK MOD':'Resultados APK',body:`Búsqueda: *${q}*\nSelecciona una aplicación.`,media:results[0].icon?{image:{url:results[0].icon}}:null,buttons:[singleSelect('Ver resultados',[{title:mod?'Aplicaciones modificadas':'Aplicaciones',rows}])]},ctx.msg)
}
async function apkPick(ctx,mod=false){
  const list=getSelection(ctx.args[0],mod?'apkmod':'apk'); const d=list?.[Number(ctx.args[1])]; if(!d) throw new Error('La selección venció. Busca nuevamente.')
  const size=Number(d.size_bytes||d.filesize_bytes||0); const details=[`*Título:* ${d.title}`,`*Versión:* ${d.version||'No disponible'}`,`*Formato:* ${d.format||'APK'}`,`*Tamaño:* ${size ? formatBytes(size) : (d.filesize || 'No disponible')}`,`*Android:* ${d.requirements||'No disponible'}`,`*Actualizado:* ${d.published_at||'No disponible'}`,`*Desarrollador:* ${d.developer||'No disponible'}`]
  if(mod){ if(d.mod_features?.length) details.push(`*Funciones MOD:* ${d.mod_features.join(', ')}`); if(d.mod_changes?.length) details.push(`*Cambios MOD:* ${d.mod_changes.join(', ')}`) }
  await ctx.sock.sendMessage(ctx.chat,{image:d.icon?{url:d.icon}:undefined,text:d.icon?undefined:details.join('\n'),caption:d.icon?details.join('\n'):undefined},{quoted:ctx.msg})
  await runDownloadJob(ctx,'heavy',mod?'.apkmod':'.apk',()=>sendRemoteMedia(ctx.sock,ctx.chat,{...d,mime_type:(d.filename||'').toLowerCase().endsWith('.apk')?'application/vnd.android.package-archive':undefined},{quoted:ctx.msg,caption:`${mod?'APK MOD':'APK'} • ${d.title}`,forceDocument:true}))
}
export const apk={name:'apk',aliases:['apkdl'],async execute(ctx){return apiTask(ctx,()=>apkSearch(ctx,false))}}
export const apkpick={name:'apkpick',aliases:[],async execute(ctx){return apiTask(ctx,()=>apkPick(ctx,false))}}
export const apkmod={name:'apkmod',aliases:['modapk'],async execute(ctx){return apiTask(ctx,()=>apkSearch(ctx,true))}}
export const apkmodpick={name:'apkmodpick',aliases:[],async execute(ctx){return apiTask(ctx,()=>apkPick(ctx,true))}}

function simpleLinkCommand(name,aliases,endpoint,paramsBuilder,captionBuilder,forceDocument=false,queueType='heavy'){return {name,aliases,async execute(ctx){return apiTask(ctx,async()=>{const url=ctx.args[0];if(!isLikelyUrl(url))throw new Error(usage(name,'<enlace>'));await runDownloadJob(ctx,queueType,`${config.prefix}${name}`,()=>directMedia(ctx,endpoint,paramsBuilder(url,ctx.args),captionBuilder,{forceDocument}))})}}}
export const facebook=simpleLinkCommand('facebook',['fb'],'/facebook',(url,args)=>({mode:'link',url,quality:args[1]||'auto'}),d=>`🎬 *${d.title||'Facebook Video'}*\n📺 ${d.quality||'Auto'}\n⏱️ ${d.duration||''}`)
export const instagram=simpleLinkCommand('instagram',['ig'],'/instagram',(url,args)=>({mode:'link',url,pick:args[1]||1,lang:'es'}),d=>`📸 *${d.title||'Instagram'}*\n👤 @${d.username||'usuario'}`)
export const twitch=simpleLinkCommand('twitch',['twitchdl'],'/twitch/download',url=>({url}),d=>`🎮 *${d.title||'Twitch'}*\n👤 ${d.author||''}\n⏱️ ${formatDuration(d.duration_seconds)||''}`)
export const mediafire=simpleLinkCommand('mediafire',['mf'],'/mediafire',url=>({mode:'link',url}),d=>`📁 *${d.filename||d.title}*\n📦 ${d.filesize||''}`,true)
export const mega=simpleLinkCommand('mega',['mg'],'/mega',url=>({mode:'link',url}),d=>`☁️ *${d.filename||d.title}*\n📦 ${d.filesize||formatBytes(d.filesize_bytes)}`,true)

export const threads={name:'threads',aliases:['savethreads'],async execute(ctx){return apiTask(ctx,async()=>{const url=ctx.args[0];if(!isLikelyUrl(url))throw new Error(usage('threads','<enlace>'));await runDownloadJob(ctx,'heavy','.threads',async()=>{const d=await apiGet('/savethreads',{mode:'link',url,quality:'best',pick:ctx.args[1]||1});const items=d.downloads?.length?d.downloads:[d];for(const item of items.slice(0,10))await sendRemoteMedia(ctx.sock,ctx.chat,item,{quoted:ctx.msg,caption:d.description||d.title||'Threads'})})})}}
export const universal={name:'universal',aliases:['dl'],async execute(ctx){return apiTask(ctx,async()=>{const url=ctx.args[0];if(!isLikelyUrl(url))throw new Error(usage('dl','<enlace>'));await runDownloadJob(ctx,'heavy','.dl',async()=>{const d=await apiGet('/universal',{mode:'link',url});const items=d.downloads?.length?d.downloads:(d.media?.length?d.media:[d]);for(const item of items.slice(0,10))await sendRemoteMedia(ctx.sock,ctx.chat,item,{quoted:ctx.msg,caption:d.title||`${d.platform||'Universal'}`})})})}}
export const pinterest={name:'pinterest',aliases:['pin','pindl'],async execute(ctx){return apiTask(ctx,async()=>{const input=queryText(ctx.args);if(!input)throw new Error(usage('pinterest','<enlace>'));if(!isLikelyUrl(input))throw new Error(`Para buscar usa *${config.prefix}pinterestsearch <nombre>*`);const d=await apiGet('/universal',{mode:'link',url:input});const items=d.downloads?.length?d.downloads:(d.media?.length?d.media:[d]);for(const item of items.slice(0,10))await sendRemoteMedia(ctx.sock,ctx.chat,item,{quoted:ctx.msg,caption:d.title||'Pinterest'})})}}

export const pinterestSearch={name:'pinterestsearch',aliases:['pinsearch'],async execute(ctx){return apiTask(ctx,async()=>{const input=queryText(ctx.args);if(!input)throw new Error(usage('pinterestsearch','<búsqueda>'));const response=await evoGet('/search/pinterestv3',{query:input});const list=(response.data?.images||[]).slice(0,10);if(!list.length)throw new Error('No encontré resultados en Pinterest.');const cards=list.map((item,index)=>{const imageUrl=item.images?.orig||item.images?.['736x']||item.images?.['474x']||item.images?.['236x'];const title=(item.title||`Pinterest #${index+1}`).slice(0,80);const creator=item.creator?.fullName||item.creator?.username||'Desconocido';const board=item.board?.name||'Sin tablero';const command=`${config.prefix}pinterest ${item.pinUrl}`;return{title,image:{url:imageUrl},body:[`*Resultado:* ${index+1}`,`*Resolución:* ${item.width||'?'}x${item.height||'?'}`,`*Creador:* ${creator}`,`*Tablero:* ${board}`].join('\n'),buttons:[copyButton('Copy',command),urlButton('Abrir Pin',item.pinUrl)]}});await sendCarousel(ctx.sock,ctx.chat,{body:`📌 *Pinterest Search*\nResultados para: *${input}*`,cards},ctx.msg)})}}

export const tiktok={name:'tiktok',aliases:['tt'],async execute(ctx){return apiTask(ctx,async()=>{const url=ctx.args[0];if(!isLikelyUrl(url))throw new Error(usage('tiktok','<enlace>'));await runDownloadJob(ctx,'heavy','.tiktok',async()=>{const response=await evoGet('/dl/tiktok',{url},{timeoutMs:180000});const d=response.data||{};if(!d.dl)throw new Error('TikTok no entregó el video.');const author=d.author?.nickname||d.author?.unique_id||'TikTok';await sendRemoteMedia(ctx.sock,ctx.chat,{type:'video',url:d.dl,download_url:d.dl,mime_type:'video/mp4',filename:`TikTok-${d.id||Date.now()}.mp4`},{quoted:ctx.msg,caption:[`🎵 *${d.title||'TikTok'}*`,`👤 ${author}`,`⏱️ ${d.duration||'No disponible'}`,`🌎 ${d.region||'--'}`,d.stats?`▶️ ${d.stats.plays||0}  ❤️ ${d.stats.likes||0}  💬 ${d.stats.comments||0}`:''].filter(Boolean).join('\n')})})})}}

export const tiktokSearch={name:'tiktoksearch',aliases:['ttsearch'],async execute(ctx){return apiTask(ctx,async()=>{const input=queryText(ctx.args);if(!input)throw new Error(usage('tiktoksearch','<búsqueda>'));const response=await evoGet('/search/tiktok',{query:input});const list=(response.data||[]).slice(0,10);if(!list.length)throw new Error('No encontré resultados en TikTok.');const cards=list.map((item,index)=>{const username=item.author?.unique_id||'usuario';const original=`https://www.tiktok.com/@${username}/video/${item.id}`;const command=`${config.prefix}tiktok ${original}`;const stats=item.stats||{};return{title:`TikTok • Resultado ${index+1}`,image:item.cover?{url:item.cover}:null,body:[`*Título:* ${(item.title||'Sin título').slice(0,180)}`,`*Duración:* ${item.duration||'--'}`,`*Autor:* @${username}`,`*Likes:* ${stats.likes||0}`,`*Comentarios:* ${stats.comments||0}`,`*Shares:* ${stats.shares||0}`,`*Reproducciones:* ${stats.views||0}`].join('\n'),buttons:[copyButton('Copy',command),urlButton('Abrir TikTok',original)]}});await sendCarousel(ctx.sock,ctx.chat,{body:`🎵 *TikTok Buscador*\nResultados para: *${input}*`,cards},ctx.msg)})}}

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

export const anime={name:'anime',aliases:['animesub'],async execute(ctx){return apiTask(ctx,async()=>{
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

export const downloadCommands=[play,playpick,ytmp3,ytmp4,spotify,spotifypick,ytmusic,ytmusicpick,apk,apkpick,apkmod,apkmodpick,facebook,instagram,twitch,threads,universal,pinterest,pinterestSearch,tiktok,tiktokSearch,mediafire,mega,terabox,teraboxpick,anime,queueStatus,cancelDownload,clearQueue]
