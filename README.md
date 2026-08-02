# Nero Bot Ultra v1.1.0

Bot de WhatsApp con Ultra Baileys, conexión por código y sección de descargas con botones/listas.

## Instalación

```bash
npm install
cp .env.example .env
nano .env
npm start
```

Configura en `.env`:

```env
DVYER_API_KEY=TU_CLAVE_PRIVADA
```

No subas `.env` ni `sessions/` a GitHub.

## Comandos de descargas

- `.play <búsqueda>`: busca YouTube y permite elegir Audio o Video.
- `.ytmp3 <url>` / `.ytmp4 <url> [calidad]`
- `.spotify <nombre o url>`
- `.ytmusic <nombre o url>`
- `.apk <nombre>` / `.apkmod <nombre>`
- `.pinterest <búsqueda o url>`
- `.instagram <url> [pick]`
- `.facebook <url> [auto|hd|sd]`
- `.twitch <url>`
- `.threads <url> [pick]`
- `.dl <url>`: Universal (Facebook, Instagram, TikTok, X/Twitter y Pinterest)
- `.mediafire <url>` / `.mega <url>` / `.terabox <url>`
- `.anime <nombre> [episodio]`

Los archivos superiores a `MAX_UPLOAD_BYTES` se entregan como enlace para evitar fallos de WhatsApp.

## Colas de descarga

Nero Bot usa dos colas independientes:

- **Ligera:** Spotify, YouTube Music y audio de YouTube.
- **Pesada:** videos, APK/XAPK, MediaFire, MEGA, TeraBox, Twitch y descargas universales.

Comandos:

```text
.cola
.cancelardescarga
.limpiarcola   # owner/subowner
```

Las búsquedas no bloquean la cola; solo la entrega del archivo.
