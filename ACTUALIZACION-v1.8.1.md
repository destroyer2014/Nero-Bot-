# Nero Bot v1.8.1

## Nuevo comando `.modo`

Permite al Owner o SubOwner configurar cada instancia por separado:

- **Solo grupos:** ignora comandos normales en chats privados.
- **Grupos y privados:** responde en ambos tipos de chat.

La selección se guarda en `data/instance-modes.json` y persiste después de reiniciar PM2 o el VPS.

En modo Solo grupos permanecen disponibles en privado los comandos esenciales:
`.code`, `.reportar`, `.menu`, `.ping` y `.modo`.

El bot principal y cada subbot conservan su propia configuración independiente.
