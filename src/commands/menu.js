import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../../config.js'
import { formatDateTime, jidToNumber } from '../lib/format.js'
const __dirname=path.dirname(fileURLToPath(import.meta.url));const projectRoot=path.resolve(__dirname,'../..')
const item=(command,description)=>[`✦ *${command}*`,`> ✐ ${description}`].join('\n')
const section=(title,entries)=>[`✦════ < ${title} > ════⚝`,'',...entries.flatMap(e=>[item(...e),''])].join('\n').trimEnd()
const sections=[
{title:'🔎 BÚSQUEDAS',entries:[
['.play <búsqueda>','Busca en YouTube con lista seleccionable.'],
['.tts • .tiktoks <búsqueda>','Busca videos de TikTok con lista seleccionable.'],
['.spotify <búsqueda>','Busca canciones de Spotify.'],
['.ytmusic <búsqueda>','Busca música en YouTube Music.'],
['.bingimg <búsqueda>','Busca imágenes en Bing.'],
['.gif • .tenor <búsqueda>','Busca GIFs y videos cortos.'],
['.npm <paquete>','Consulta información de un paquete NPM.'],
['.googleimages <búsqueda>','Busca imágenes en Google.'],
['.wikipedia • .wiki <consulta>','Busca información en Wikipedia.'] ]},
{title:'📥 DESCARGAS',entries:[
['.tiktok • .tt <url>','Descarga videos de TikTok.'],
['.ttimg <url>','Descarga fotos de TikTok.'],
['.ttmp3 <url>','Descarga audio de TikTok.'],
['.ytmp3 <url>','Descarga audio de YouTube.'],
['.ytmp4 <url>','Descarga video de YouTube.'],
['.facebook • .fb <url>','Descarga contenido de Facebook.'],
['.twitter • .x <url>','Descarga contenido de Twitter/X.'],
['.instagram • .ig <url>','Descarga contenido de Instagram.'],
['.mediafire • .mf <url>','Descarga archivos de MediaFire.'],
['.mega • .meganz <url>','Descarga archivos de Mega.nz.'],
['.terabox • .tera <url>','Descarga archivos de Terabox.'],
['.gitclone <url>','Descarga repositorios de GitHub.'],
['.npmdl <paquete>','Descarga paquetes NPM.'] ]},
{title:'🖼️ STICKERS',entries:[
['.s • .sticker','Crea un sticker desde imagen o video.'],
['.textosticker • .tstk <texto>','Crea un sticker de texto.'],
['.setpack <nombre>','Cambia el nombre del paquete.'],
['.setauthor <autor>','Cambia el autor del paquete.'],
['.stickermeta','Consulta los metadatos actuales.'],
['.stickersearch <búsqueda>','Busca paquetes de stickers.'] ]},
{title:'🧩 GENERADORES',entries:[
['.animatedgif triggered|blink','Crea un GIF animado desde una imagen.'],
['.filtro','Muestra filtros seleccionables para una imagen.'],
['.textogif • .textgif <texto>','Genera un GIF animado de texto.'],
['.textoimagen • .textimg <texto>','Genera una imagen con texto.'] ]},
{title:'🛠️ UTILIDADES',entries:[
['.server • .serverinfo','Muestra el estado público del servidor de Nero.'],
['.ocr','Extrae texto de una imagen.'],['.shazam • .whatmusic','Identifica música en audio o video.'],
['.acortar <url> [alias]','Acorta enlaces.'],['.hostinfo <dominio>','Consulta información pública de un host.'],
['.minecraft <host> [edición]','Consulta un servidor Minecraft.'],['.npmfull <paquete>','Envía la respuesta completa de NPM en JSON.'],
['.qr <texto>','Genera un código QR.'],['.traducir <idioma> <texto>','Traduce textos.'],
['.ssweb <url>','Captura una página web.'],['.hd • .upscale','Mejora imágenes.'],
['.removebg','Elimina el fondo de una imagen.'],['.transcribir','Transcribe audio o video.'] ]},
{title:'🌸 ANIME Y REACCIONES',entries:[
['.reacciones','Muestra las reacciones normales.'],['.animereacciones','Muestra las reacciones anime de EvoGB.'],
['.ar <tipo> [@usuario]','Envía una reacción anime.'],['.girls random|sexy|asian','Envía una imagen SFW de la categoría.'],
['.animenews','Muestra noticias de anime.'],['.animeschedule','Muestra el calendario de anime.'] ]},
{title:'🔎 STALKING PÚBLICO',entries:[
['.githubstalk <usuario>','Consulta información pública de GitHub.'],['.instagramstalk <usuario>','Consulta información pública de Instagram.'],
['.robloxstalk <usuario>','Consulta información pública de Roblox.'],['.telegramstalk <canal>','Consulta información pública de Telegram.'],
['.tiktokstalk <usuario>','Consulta información pública de TikTok.'] ]},
{title:'🔞 NSFW',entries:[['.nsfwmenu','Muestra la sección adulta habilitada.'],['.nsfwactivar on|off','Activa o desactiva comandos adultos en el grupo.'],['.ph <búsqueda>','Busca videos en Pornhub.'],['.xnxxsearch <búsqueda>','Busca videos en XNXX con lista seleccionable.'],['.xvideossearch <búsqueda>','Busca videos en XVideos con lista seleccionable.']]},
{title:'🎴 GACHA',entries:[
['.w','Genera un personaje con su imagen para reclamar.'],
['.claim • .c','Reclama la aparición activa.'],
['.harem • .collection','Muestra tu colección.'],
['.character • .char <nombre/id>','Muestra la ficha de un personaje.'],
['.wish <personaje>','Añade un personaje a tu wishlist.'],
['.balance • .bal • .wallet','Consulta monedas, tickets y patrimonio.'],
['.daily','Recompensa diaria.'],
['.trade @usuario','Inicia un intercambio.'],
['.market','Muestra el mercado global.'],
['.battle','Combate PvE con tu equipo.'],
['.gachastats','Muestra tus estadísticas.'],
['.topgacha','Ranking general del Gacha.'],
['.gachaprofile','Muestra tu perfil Gacha.'],
['.gachainfo','Muestra TODOS los comandos Gacha.'] ]},
{title:'🛡️ GRUPOS Y SEGURIDAD',entries:[['.antinsfw on|off','Activa o desactiva el detector NSFW.'],['.antilink on|off','Activa o desactiva anti-enlaces.'],['.warn • .warns • .resetwarn','Administra advertencias.'],['.bienvenida • .despedida','Configura entradas y salidas.'],['.promote • .demote • .kick','Administra participantes.'],['.abrir • .cerrar','Abre o cierra el grupo.'],['.tagall • .hidetag','Menciona participantes.']]},
{title:'🤖 SUBBOTS',entries:[['.code','Genera un código de vinculación.'],['.bots','Muestra subbots conectados.'],['.setbot','Selecciona la instancia del grupo.'],['.principal','Consulta la instancia elegida.'],['.logout','Cierra la sesión del subbot.']]},
{title:'🤖 INTELIGENCIA ARTIFICIAL',entries:[['.ia • .gemini','Conversa con IA.'],['.bot','Analiza un mensaje citado.'],['.imgprompt','Describe una imagen.'],['.editimg','Edita una imagen con IA.']]},
{title:'📨 SOPORTE',entries:[['.reportar <motivo>','Envía un reporte al equipo.']]},
{title:'👑 OWNER',entries:[['.vv','Recupera contenido de una visualización.'],['.ownerinfo','Muestra información del Owner.'],['.restart','Reinicia Nero.']]}
]
export const command={name:'menu',aliases:['help','comandos'],description:'Muestra todos los comandos.',async execute({sock,msg,chat,sender,instanceType,botName,subbotConfig}){const{date,time}=formatDateTime(config.timezone);const mention=`@${jidToNumber(sender)}`;const uptime=Math.floor(process.uptime());const hours=Math.floor(uptime/3600);const minutes=Math.floor((uptime%3600)/60);const isSubbot=instanceType==='subbot'||config.instanceType==='subbot';const type=isSubbot?'Subbot':'Bot principal';const displayBotName=isSubbot?(botName||subbotConfig?.botName||config.botName):config.botName;const header=[`✦════ < 🖤 ${String(displayBotName).toUpperCase()} > ════⚝`,'',`✦ *Usuario:* ${mention}`,`✦ *Creador:* ${config.creator}`,`✦ *Versión:* ${config.version}`,`✦ *Instancia:* ${type}`,`✦ *Tiempo activo:* ${hours} h ${minutes} min`,`✦ *Enlace:* ${config.website}`,`✦ *Fecha:* ${date}`,`✦ *Hora:* ${time}`,''].join('\n');const salesHint='> Para ver comandos de administración de tu negocio usa *.salesinfo*\n\n';const body=`${header}${salesHint}${sections.map(({title,entries})=>section(title,entries)).join('\n\n')}\n\n✦════ < ✨ FIN DEL MENÚ > ════⚝`;if(isSubbot&&subbotConfig?.avatarUrl){try{await sock.sendMessage(chat,{image:{url:subbotConfig.avatarUrl},caption:body,mentions:[sender]},{quoted:msg});return}catch{}}try{const video=await fs.readFile(path.resolve(projectRoot,config.menuVideo));await sock.sendMessage(chat,{video,gifPlayback:true,caption:body,mentions:[sender]},{quoted:msg})}catch{await sock.sendMessage(chat,{text:body,mentions:[sender]},{quoted:msg})}}}
