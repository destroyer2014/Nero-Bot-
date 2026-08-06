# Nero Bot v1.9.0

## Detector Anti-NSFW

- EvoGB reconoce `analysis.is_nsfw`, `analysis.confidence`, `analysis.flag` y `raw_scores`.
- Analiza imágenes, videos, stickers, mensajes efímeros y contenido de una sola visualización cuando Baileys permite descargarlo.
- El contenido NSFW de owners y administradores también se elimina, pero no acumula advertencias ni provoca expulsión.
- El detector funciona en el bot principal y en los subbots.
- Solo la instancia elegida con `.setbot` analiza y modera el grupo.
- El modo `.antinsfw debug on` muestra errores de API y falta de permisos de administrador.
- `groups.json` se recarga entre procesos para que principal y subbots compartan la configuración actual.

## Sección NSFW para adultos

- Desactivada por defecto en todos los grupos.
- Activación administrativa con `.nsfwactivar on/off`.
- Menú completo con `.nsfwmenu`.
- Búsqueda y descarga mediante EvoGB: Pornhub, XNXX, XVideos, Rule34 y Danbooru.
- Contenido aleatorio e interacciones disponibles según la API.
- Bloqueo de consultas relacionadas con menores, abuso, falta de consentimiento, cámaras ocultas, explotación, animales y categorías de edad ambigua explícita.
- No se guardan archivos NSFW permanentemente; se descargan solo para enviarlos a WhatsApp.

## Stalking público

- `.githubstalk`
- `.instagramstalk`
- `.robloxstalk`
- `.telegramstalk`
- `.tiktokstalk`

Estos comandos muestran únicamente información pública devuelta por EvoGB.

## Configuración

Añadir al `.env` del VPS:

```env
EVOGB_API_KEY=COLOCA_AQUI_LA_CLAVE_NUEVA
EVOGB_API_BASE_URL=https://api.evogb.org
```

La clave compartida durante las pruebas debe regenerarse antes de producción.
