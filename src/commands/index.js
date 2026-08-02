import { command as menu } from './menu.js'
import { command as ping } from './ping.js'
import { command as info } from './info.js'
import { downloadCommands } from './downloads.js'
import { toolCommands } from './tools.js'
import { moderationCommands } from './moderation.js'
import { testCarousel, testModernInteractive } from './debug.js'

const commands = [menu, ping, info, testCarousel, testModernInteractive, ...downloadCommands, ...toolCommands, ...moderationCommands]
const commandMap = new Map()
for (const command of commands) {
  commandMap.set(command.name, command)
  for (const alias of command.aliases || []) commandMap.set(alias, command)
}
export function findCommand(name) { return commandMap.get(name.toLowerCase()) }
