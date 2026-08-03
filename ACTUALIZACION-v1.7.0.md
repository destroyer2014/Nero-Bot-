# Nero Bot v1.7.0 — NexusTechPro Baileys

## Cambios

- Sustituye RussellXZ Ultra por `@nexustechpro/baileys@2.2.0`.
- Usa un alias npm para conservar todos los imports `@whiskeysockets/baileys`.
- Mantiene la sesión, conexión por código, comandos, permisos y PM2.
- Conserva el carrusel protobuf de Nero para probarlo sobre Nexus.
- Elimina la necesidad de modificar `node_modules`.

## Instalación en VPS

```bash
cd /opt/nero-bot
pm2 stop nero-bot
git fetch origin
git reset --hard origin/main
rm -rf node_modules package-lock.json
npm install
pm2 start nero-bot
pm2 save
pm2 flush
```

## Pruebas

1. `.ping`
2. `.menu`
3. `.testcards`
4. `.testcardsbtn`
5. `.tiktoksearch tenis de mesa Perú`

No borres `sessions/principal` durante esta actualización.
