import { command as menu } from './menu.js'
import { command as ping } from './ping.js'
import { command as info } from './info.js'
import { downloadCommands } from './downloads.js'
import { toolCommands } from './tools.js'
import { moderationCommands } from './moderation.js'
import { testCarousel, testModernInteractive } from './debug.js'
import { aiCommands } from './ai.js'
import { animeCommands } from './anime.js'
import { ownerCommands } from './owner.js'
import { reportCommand } from './report.js'
import { subbotCommands } from './subbots.js'
import { modeCommands } from './mode.js'
import { favoriteCommands } from './favorites.js'
import { reactionCommands } from './reactions.js'

const commands = [menu, ping, info, reportCommand, ...modeCommands, ...favoriteCommands, ...reactionCommands, ...subbotCommands, ...downloadCommands, ...toolCommands, ...aiCommands, ...animeCommands, ...moderationCommands, ...ownerCommands]
const commandMap = new Map()
for (const command of commands) {
  commandMap.set(command.name, command)
  for (const alias of command.aliases || []) commandMap.set(alias, command)
}
export function findCommand(name) { return commandMap.get(name.toLowerCase()) }
