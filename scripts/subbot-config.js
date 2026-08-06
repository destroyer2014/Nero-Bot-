import { getSubbotConfig, setSubbotConfig } from '../src/lib/subbotConfigStore.js'

const args = process.argv.slice(2)
const id = args.shift()
if (!id) {
  console.error('Uso: node scripts/subbot-config.js <id> [--name "Nombre"] [--prefix .] [--status "Texto"] [--avatar URL] [--avatar-path RUTA] [--auto-read true|false] [--welcome true|false] [--goodbye true|false] [--welcome-text TEXTO] [--goodbye-text TEXTO] [--pack-name NOMBRE] [--pack-author AUTOR] [--apply-profile true|false]')
  process.exit(1)
}

const patch = {}
for (let i = 0; i < args.length; i += 2) {
  const key = args[i]
  const value = args[i + 1]
  if (value === undefined) throw new Error(`Falta el valor de ${key}`)
  if (key === '--name') patch.botName = value
  else if (key === '--prefix') patch.prefix = value
  else if (key === '--status') patch.statusText = value
  else if (key === '--avatar') patch.avatarUrl = value
  else if (key === '--avatar-path') patch.avatarPath = value
  else if (key === '--auto-read') patch.autoRead = value === 'true'
  else if (key === '--welcome') patch.welcomeEnabled = value === 'true'
  else if (key === '--goodbye') patch.goodbyeEnabled = value === 'true'
  else if (key === '--welcome-text') patch.welcomeText = value
  else if (key === '--goodbye-text') patch.goodbyeText = value
  else if (key === '--pack-name') patch.packName = value
  else if (key === '--pack-author') patch.packAuthor = value
  else if (key === '--apply-profile') patch.applyProfile = value === 'true'
  else if (key === '--disabled') patch.disabledCommands = value.split(',').map(x => x.trim()).filter(Boolean)
  else throw new Error(`Opción desconocida: ${key}`)
}

const result = Object.keys(patch).length
  ? setSubbotConfig(id, patch)
  : getSubbotConfig(id)
console.log(JSON.stringify(result, null, 2))
