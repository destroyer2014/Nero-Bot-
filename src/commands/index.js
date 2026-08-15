import { command as menu } from './menu.js'
import { command as ping } from './ping.js'
import { speedtestCommand } from './speedtest.js'
import { command as info } from './info.js'
import { downloadCommands } from './downloads.js'
import { toolCommands } from './tools.js'
import { moderationCommands } from './moderation.js'
import { testCarousel, testModernInteractive } from './debug.js'
import { aiCommands } from './ai.js'
import { animeCommands } from './anime.js'
import { ownerCommands } from './owner.js'
import { safeOwnerCommands } from './owner-safe.js'
import { reportCommand } from './report.js'
import { supportCommand } from './support.js'
import { subbotCommands } from './subbots.js'
import { identityCommands } from './identity.js'
import { modeCommands } from './mode.js'
import { favoriteCommands } from './favorites.js'
import { reactionCommands } from './reactions.js'
import { nsfwCommands } from './nsfw.js'
import { stalkingCommands } from './stalking.js'
import { stickerCommands } from './stickers.js'
import { generatorCommands } from './generators.js'
import { extraSearchCommands } from './extra-search.js'
import { peruLookupCommands } from './peru.js'
import { extraUtilityCommands } from './extra-utils.js'
import { animeEvoCommands } from './anime-evo.js'
import { gachaCommands } from './gacha.js'
import { salesCommands } from './sales.js'
import { serverCommand } from './server.js'
import { gameCommands } from './games.js'
import { movieCommands } from './movies.js'

const commands = [
  menu,
  ping,
  speedtestCommand,
  info,
  serverCommand,
  ...gameCommands,
  ...movieCommands,
  ...salesCommands,
  reportCommand,
  supportCommand,
  ...modeCommands,
  ...favoriteCommands,
  ...reactionCommands,
  ...animeEvoCommands,
  ...gachaCommands,
  ...subbotCommands,
  ...identityCommands,
  ...downloadCommands,
  ...extraSearchCommands,
  ...peruLookupCommands,
  ...toolCommands,
  ...extraUtilityCommands,
  ...generatorCommands,
  ...stickerCommands,
  ...aiCommands,
  ...animeCommands,
  ...stalkingCommands,
  ...nsfwCommands,
  ...moderationCommands,
  ...ownerCommands,
  ...safeOwnerCommands
]

const commandMap = new Map()
for (const command of commands) {
  commandMap.set(command.name, command)
  for (const alias of command.aliases || []) commandMap.set(alias, command)
}

export function findCommand(name) {
  return commandMap.get(name.toLowerCase())
}
