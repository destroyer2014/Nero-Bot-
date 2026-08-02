# Nero Bot v1.5.0

## Cambios principales

- Carrusel directo experimental con `sock.sendMessage({ cards })` en `.tiktoksearch`.
- Lista interactiva de respaldo siempre disponible para que TikTok Search no quede sin respuesta.
- Comando `.testcards` para comprobar compatibilidad del fork/cliente.
- IA: `.ia`, `.gemini`, `.claude`, `.qwen`, `.bot`, `.imgprompt`, `.editimg`.
- Anime: `.animenews`, `.animeschedule`, `.neko`, `.bluearchive`, `.angry`.
- Administración persistente: Anti-NSFW EvoGB, antilink, warn 3/3, bienvenida/despedida, personalización de textos e imágenes, grupo abierto/cerrado, temporizadores, promote/demote/kick, tagall/hidetag.
- Owner: `.vv` para recuperar manualmente foto o video citado de una sola vista.
- Menú reorganizado con IA, Anime, Administración y Owner.

## Variables necesarias

```env
DVYER_API_KEY=...
EVOGB_API_KEY=...
EVOGB_API_BASE_URL=https://api.evogb.org
```

## Nota del carrusel

El carrusel directo depende de que el fork instalado acepte `cards` en `sock.sendMessage()`. La lista interactiva se envía como respaldo porque algunas cuentas de WhatsApp aceptan el envío técnico pero no renderizan el carrusel.
