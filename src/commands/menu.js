import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../../config.js'
import { formatDateTime, jidToNumber } from '../lib/format.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')
const box=(title,lines)=>[`╭─〔 *${title}* 〕`,`│ ${lines.join('\n│ ')}`,'╰────────────'].join('\n')
const menus={
 descargas:()=>box('DESCARGAS',[`.play <nombre>`,`.ytmp3 <url>`,`.ytmp4 <url>`,`.spotify <nombre/url>`,`.ytmusic <nombre/url>`,`.tiktok <url>`,`.instagram <url>`,`.facebook <url>`,`.pinterest <url>`,`.mediafire <url>`,`.mega <url>`,`.terabox <url>`,`.apk <nombre>`,`.apkmod <nombre>`,`.anime <nombre>`]),
 buscadores:()=>box('BUSCADORES',[`.ytsearch/.play <nombre>`,`.tiktoksearch <nombre>`,`.pinterestsearch <nombre>`,`.googleimages <nombre>`,`.wikipedia <consulta>`,`.stickersearch <nombre>`]),
 herramientas:()=>box('HERRAMIENTAS',[`.hd (responder imagen o URL)`,`.upscale (responder imagen o URL)`,`.convertir <formato> <url>`,`.comprimir [calidad] <url>`,`.restaurar <url>`,`.textoimagen <texto>`,`.textogif <texto>`,`.qr <texto/url>`,`.ytthumb <url>`,`.traducir <idioma> <texto>`,`.checkhost <dominio>`,`.pais <nombre>`,`.ssweb <url>`,`.tempmail`,`.tempmail inbox`,`.shazam (responder audio)`,`.quitarvoz (responder audio)`,`.transcribir (responder audio)`]),
 stickers:()=>box('STICKERS',[`.sticker (responder imagen/video)`,`.textosticker <texto>`,`.stickerwm paquete|autor`,`.renombrarsticker paquete|autor`,`.toimg (próximamente animados)`]),
 administracion:()=>box('ADMINISTRACIÓN',[`.antinsfw on/off`,`.warns @usuario`,`.resetwarn @usuario`,`.cola`,`.cancelardescarga`,`.limpiarcola`])
}

export const command={name:'menu',aliases:['help','comandos','descargas','buscadores','herramientas','tools','stickers','administracion'],async execute({sock,msg,chat,sender,text}){
 const invoked=text.slice(config.prefix.length).trim().split(/\s+/)[0].toLowerCase()
 if(menus[invoked]) return sock.sendMessage(chat,{text:menus[invoked]()},{quoted:msg})
 const {date,time}=formatDateTime(config.timezone);const mention=`@${jidToNumber(sender)}`
 const body=[
  `*${config.botName}*`,
  `👤 ${mention}`,
  `📅 ${date} • 🕒 ${time}`,
  `🤖 v${config.version}`,
  `Prefijo: ${config.prefix}`,
  '',
  box('SECCIONES',[`${config.prefix}descargas`,`${config.prefix}buscadores`,`${config.prefix}herramientas`,`${config.prefix}stickers`,`${config.prefix}administracion`])
 ].join('\n')
 try{
  const video=await fs.readFile(path.resolve(projectRoot,config.menuVideo))
  await sock.sendMessage(chat,{video,gifPlayback:true,caption:body,mentions:[sender]},{quoted:msg})
 }catch{
  await sock.sendMessage(chat,{text:body,mentions:[sender]},{quoted:msg})
 }
}}
