import config from '../../config.js'
import { getFavorites, addFavorite, removeFavorite, clearFavorites } from '../lib/favoritesStore.js'

function render(sender) {
  const list = getFavorites(sender)
  if (!list.length) {
    return [
      '⭐ *Tus comandos favoritos*',
      '',
      'Todavía no guardaste ninguno.',
      `Usa *${config.prefix}favadd comando* para añadirlo.`,
      `Ejemplo: *${config.prefix}favadd tiktok*`
    ].join('\n')
  }
  return ['⭐ *Tus comandos favoritos*', '', ...list.map((name, i) => `${i + 1}. *${config.prefix}${name}*`), '', `Eliminar: *${config.prefix}favdel comando*`].join('\n')
}

export const favCommand = {
  name: 'fav', aliases: ['favoritos', 'favorites'], description: 'Muestra tus comandos favoritos.',
  async execute(ctx) { await ctx.sock.sendMessage(ctx.chat, { text: render(ctx.sender) }, { quoted: ctx.msg }) }
}
export const favAddCommand = {
  name: 'favadd', aliases: ['agregarfav'], description: 'Añade un comando a favoritos.',
  async execute(ctx) {
    const name = String(ctx.args?.[0] || '').replace(/^\./, '').toLowerCase()
    if (!name) throw new Error(`Indica un comando. Ejemplo: ${config.prefix}favadd tiktok`)
    addFavorite(ctx.sender, name)
    await ctx.sock.sendMessage(ctx.chat, { text: `⭐ *${config.prefix}${name}* fue añadido a tus favoritos.` }, { quoted: ctx.msg })
  }
}
export const favDelCommand = {
  name: 'favdel', aliases: ['quitarfav'], description: 'Quita un comando de favoritos.',
  async execute(ctx) {
    const name = String(ctx.args?.[0] || '').replace(/^\./, '').toLowerCase()
    if (!name) throw new Error(`Indica un comando. Ejemplo: ${config.prefix}favdel tiktok`)
    removeFavorite(ctx.sender, name)
    await ctx.sock.sendMessage(ctx.chat, { text: `🗑️ *${config.prefix}${name}* fue retirado de tus favoritos.` }, { quoted: ctx.msg })
  }
}
export const favClearCommand = {
  name: 'favclear', aliases: ['limpiarfav'], description: 'Borra todos tus favoritos.',
  async execute(ctx) { clearFavorites(ctx.sender); await ctx.sock.sendMessage(ctx.chat, { text: '🗑️ Tus favoritos fueron eliminados.' }, { quoted: ctx.msg }) }
}
export const favoriteCommands = [favCommand, favAddCommand, favDelCommand, favClearCommand]
