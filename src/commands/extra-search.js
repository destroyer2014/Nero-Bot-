import config from '../../config.js'
import { evoGet } from '../lib/api.js'
import { sendInteractive, singleSelect } from '../lib/interactive.js'
import { saveSelection, getSelection } from '../lib/selectionCache.js'

const q = ctx => ctx.args.join(' ').trim()

export const bingimg = {
  name: 'bingimg', aliases: ['bingimage'],
  async execute(ctx) {
    const query = q(ctx); if (!query) throw new Error('Uso: .bingimg <búsqueda>')
    const d = await evoGet('/search/bingimage', { query })
    const list = (d.result || []).filter(x => x.image).slice(0, 10)
    if (!list.length) throw new Error('No encontré imágenes.')
    const token = saveSelection('bingimg', list)
    const rows = list.map((x,i) => ({ header: `Imagen ${i+1}`, title: String(x.title || `Resultado ${i+1}`).slice(0,90), description: 'Enviar imagen', id: `${config.prefix}bingimgpick ${token} ${i}` }))
    await sendInteractive(ctx.sock, ctx.chat, { title: 'Bing Imágenes', body: `Resultados para: *${query}*\nSelecciona una imagen.`, media: list[0].thumbnail ? { image: { url: list[0].thumbnail } } : null, buttons: [singleSelect('Ver resultados', [{ title: 'Imágenes', rows }])] }, ctx.msg)
  }
}

export const bingimgpick = {
  name: 'bingimgpick', aliases: [],
  async execute(ctx) {
    const list = getSelection(ctx.args[0], 'bingimg'); const item = list?.[Number(ctx.args[1])]
    if (!item) throw new Error('La selección venció. Ejecuta .bingimg nuevamente.')
    await ctx.sock.sendMessage(ctx.chat, { image: { url: item.image }, caption: `🖼️ *${item.title || 'Imagen'}*\n${item.source || ''}` }, { quoted: ctx.msg })
  }
}

export const gifsearch = {
  name: 'gif', aliases: ['tenor'],
  async execute(ctx) {
    const query = q(ctx); if (!query) throw new Error('Uso: .gif <búsqueda>')
    const d = await evoGet('/search/tenor', { query, provider: 'klipy' })
    const list = (d.medias || []).map(x => ({ type: x.type, url: x.data?.url })).filter(x => x.url).slice(0,10)
    if (!list.length) throw new Error('No encontré GIFs.')
    const token = saveSelection('gifsearch', list)
    const rows = list.map((_,i) => ({ header: `GIF ${i+1}`, title: `Resultado ${i+1}`, description: 'Enviar animación', id: `${config.prefix}gifpick ${token} ${i}` }))
    await sendInteractive(ctx.sock, ctx.chat, { title: 'Buscador de GIFs', body: `Resultados para: *${query}*`, buttons: [singleSelect('Ver resultados', [{ title: 'GIFs', rows }])] }, ctx.msg)
  }
}

export const gifpick = {
  name: 'gifpick', aliases: [],
  async execute(ctx) {
    const list = getSelection(ctx.args[0], 'gifsearch'); const item = list?.[Number(ctx.args[1])]
    if (!item) throw new Error('La selección venció. Ejecuta .gif nuevamente.')
    await ctx.sock.sendMessage(ctx.chat, { video: { url: item.url }, gifPlayback: true, mimetype: 'video/mp4' }, { quoted: ctx.msg })
  }
}

export const extraSearchCommands = [bingimg, bingimgpick, gifsearch, gifpick]
