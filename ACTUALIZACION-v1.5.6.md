# Nero Bot v1.5.6

Esta actualización conserva Ultra Baileys y todos los comandos de la v1.5.5.

## Cambio realizado

- Ya no depende de la versión WA Web fijada internamente por el fork.
- Consulta al iniciar la versión publicada por el repositorio oficial de Baileys.
- Si la consulta falla, usa una versión de respaldo.
- Permite forzar una versión desde `.env` con `NERO_WA_VERSION=2,3000,XXXXXXXXXX`.
- No modifica TikTok, el carrusel, las IAs, la cola de edición ni otros comandos.

## Instalación limpia

```bash
rm -rf node_modules package-lock.json
rm -rf sessions/principal
mkdir -p sessions/principal
npm install
npm start
```

Al iniciar debe mostrar una línea `WA Web v...` indicando si la versión fue obtenida en línea, configurada o tomada del respaldo.
