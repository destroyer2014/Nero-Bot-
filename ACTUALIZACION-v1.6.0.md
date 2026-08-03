# Nero Bot v1.6.0 — Ultra Baileys + QR

Esta versión modifica únicamente el método de conexión:

- Restaura Ultra Baileys (`russellxz/ultra-baileys`).
- Elimina por completo `requestPairingCode()`.
- Genera e imprime el QR real recibido en `connection.update`.
- Usa `qrcode-terminal` para que el QR sea visible en SSH/Termux.
- Mantiene IA, cola de edición, TikTok, administración y todos los comandos sin cambios.

Para una vinculación limpia, elimina solo `sessions/principal` antes de iniciar.
