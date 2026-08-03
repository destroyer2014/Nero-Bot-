# Nero Bot v1.6.6

## Carrusel TikTok

Esta versión conserva RussellXZ Ultra Baileys para la conexión y vinculación por código.
No instala ni utiliza el fork DevYer.

El soporte de `sock.sendMessage({ cards })` se porta mediante un parche local aplicado automáticamente por:

```bash
npm install
```

Durante la instalación debe aparecer:

```text
[NERO CARDS] Carrusel instalado en .../node_modules/@whiskeysockets/baileys/lib/Utils/messages.js
```

Pruebas:

```text
.testcards
.testcardsbtn
.tiktoksearch tenis de mesa Perú
```

## Comandos Owner

```text
.vv
.restart
.ownerinfo
.join <enlace>
.leave
.block @usuario
.unblock @usuario
.setnamebot <nombre>
.setppbot   (respondiendo a una imagen)
.broadcast <mensaje>
.exec <comando VPS>
.eval <expresión JavaScript>
```

`.exec` y `.eval` tienen acceso total al proceso/VPS y solo deben usarse desde una cuenta Owner confiable.

## Actualización con PM2

```bash
cd /opt/nero-bot
pm2 stop nero-bot
git fetch origin
git reset --hard origin/main
rm -rf node_modules package-lock.json
npm install
pm2 start nero-bot
pm2 save
pm2 logs nero-bot --lines 80 --nostream
```

No borres `sessions/principal`.
