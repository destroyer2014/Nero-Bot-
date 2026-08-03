# Nero Bot v1.5.1

- Owner principal: `51917611323`.
- Reconocimiento del owner cuando WhatsApp entrega el remitente como `@lid`.
- Permite ampliar los LID con `OWNER_LIDS` en `.env`.
- Baileys se instala desde `DevYerZx/fsociety-Baileys`, fork que procesa `cards` directamente en `sock.sendMessage()`.
- `.testcards` usa dos imágenes locales y todas las tarjetas incluyen `buttons` válidos.
- `.tiktoksearch` conserva la lista interactiva como respaldo.

Después de actualizar en el VPS, reinstala dependencias desde cero:

```bash
rm -rf node_modules package-lock.json
npm install
npm start
```
