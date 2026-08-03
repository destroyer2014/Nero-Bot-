# Nero Bot v1.6.1

- Restaura exactamente el sistema de vinculación por código que utilizaba la v1.5.3.
- Restaura el manejador estable de mensajes de la v1.5.3 (`resolveChatJid` y `resolveSenderIdentity`).
- Conserva los comandos y módulos de la base actual, incluida la cola/cooldown de edición IA y los créditos de Nero AI.
- Elimina el flujo QR y vuelve a `requestPairingCode()`.
- Usa la misma dependencia Baileys de la v1.5.3: `github:DevYerZx/fsociety-Baileys`.
