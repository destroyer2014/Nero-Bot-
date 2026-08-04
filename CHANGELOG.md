# v1.8.3

- Rediseña `.menu` con encabezados `✦════ < SECCIÓN > ════⚝` y elimina las barras laterales.
- `.reacciones` ahora muestra todas las acciones en texto, sin lista seleccionable.
- Corrige el uso de reacciones con mención o mensaje citado y evita reportes falsos por falta de objetivo.
- Mejora la detección de URLs de GIF en respuestas variables de la API.
- Configura y normaliza al SubOwner `51921909260`.
- Conserva IA, descargas, favoritos, subbots, moderación y comandos existentes.

# v1.6.5
- Carrusel TikTok con banner local y media por tarjeta.
- Comandos de diagnóstico restringidos al owner.
- Resolución de administrador y menciones @lid corregida.
- Respuestas visibles para promote, demote y kick.
- Ultra Baileys y conexión por código sin cambios.

# Historial de cambios de Nero Bot

## v1.6.4

- Carrusel nativo de TikTok con imágenes, datos y botón Copy.
- Detección robusta del bot y usuarios administradores con JID/LID.
- Anti-NSFW con prueba y modo debug.
- Bienvenida y despedida corregidas, con comandos de prueba.
- Historial consolidado en este archivo.

## v1.5.0

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

## v1.5.1

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

## v1.5.2

# Nero Bot v1.5.2

- Resuelve el número del remitente cuando WhatsApp entrega un LID en grupos usando `groupMetadata`.
- Mantiene el owner principal `51917611323`.
- `.testcards` prueba primero un carrusel sin botones para aislar el fallo del fork.
- `.testcardsbtn` prueba por separado el botón dentro del carrusel.
- `.tiktoksearch` usa tarjetas sin botones y mantiene la lista interactiva para descargar.

## v1.5.3

# Nero Bot v1.5.3

## Correcciones de IA

- `.editimg`, `.nano` y `.editar` detectan automáticamente la imagen citada.
- NanoBanana se consulta con `method=local`, archivo multipart y el prompt del usuario.
- Ya no es necesario escribir manualmente `method=local` ni proporcionar una URL.
- Se aceptan respuestas binarias y enlaces en distintos campos de EvoGB.
- Timeout ampliado a 3 minutos para edición de imágenes.
- `.imgprompt` solicita procesamiento local e intenta traducir automáticamente el resultado al español.

## Uso

Responde a una imagen y escribe:

```text
.editimg cambia el fondo a rojo
```

Para obtener un prompt descriptivo:

```text
.imgprompt
```

## v1.5.4

# Nero Bot v1.5.4

## Carrusel TikTok

- Corrige el fallo `Cannot read properties of undefined (reading 'buttons')` del fork fsociety-Baileys.
- Añade un parche automático durante `npm install` para la implementación `cards` instalada en `node_modules`.
- Acepta tarjetas sin botones y botones como arreglo directo.
- Inserta `messageVersion: 1` y envuelve el carrusel como mensaje interactivo de una sola vista.
- `.tiktoksearch` mantiene la lista interactiva como respaldo.
- `.testcards` y `.testcardsbtn` permiten comprobar el carrusel básico y con botón.

## Edición de imágenes IA

- Cola global: se procesa una imagen a la vez.
- Cooldown compartido de 10 minutos por usuario para `.editimg`, `.nano` y `.editar`.
- El cooldown empieza cuando la edición termina correctamente.
- Impide solicitudes duplicadas del mismo usuario.
- Nuevos comandos `.editqueue` y `.cancelaredit`.
- Todos los mensajes de IA muestran el crédito:
  `> Nero AI - IA de ArcadiaCorps`

## v1.5.5

# Nero Bot v1.5.5

Cambio único de esta versión:

- Se restauró Ultra Baileys (`github:russellxz/ultra-baileys#master`) bajo `@whiskeysockets/baileys`.
- Se eliminaron el `postinstall` y el parche de fsociety-Baileys.
- No se modificaron TikTok Search, carrusel, IA, colas, menús ni comandos.

Después de actualizar, reinstalar dependencias desde cero y volver a vincular la sesión.

## v1.5.6

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

## v1.5.7

# Nero Bot v1.5.7

## Cambio principal

- Cambia la vinculación de código telefónico a código QR.
- Mantiene Ultra Baileys.
- Conserva TikTok, IA, cola de edición, administración y demás comandos sin cambios.
- La versión de WhatsApp Web continúa resolviéndose dinámicamente.

## Vinculación

1. Elimina la sesión incompleta en `sessions/principal`.
2. Ejecuta `npm start`.
3. Abre WhatsApp Business > Dispositivos vinculados > Vincular un dispositivo.
4. Escanea el QR mostrado en la terminal.

## v1.5.8

# Nero Bot v1.5.8 — Prueba ItsLia Baileys por QR

- Cambia únicamente la dependencia de Baileys a `@itsliaaa/baileys@0.3.0-rc.9` mediante alias compatible.
- Conserva los imports actuales `@whiskeysockets/baileys`, por lo que no se modifican comandos.
- Mantiene vinculación por QR.
- No modifica TikTok, carrusel, IA, cola de edición, administración ni menús.
- Requiere borrar `node_modules`, `package-lock.json` y la sesión incompleta antes de probar.

## v1.5.9

# Nero Bot v1.5.9

- Mantiene ItsLia Baileys (`@itsliaaa/baileys@0.3.0-rc.9`).
- Cambia únicamente la vinculación: QR → código de teléfono.
- Solicita el número con código de país o usa `NERO_PHONE` desde `.env`.
- No modifica TikTok, carrusel, IA, cola, administración ni comandos.

## v1.6.0

# Nero Bot v1.6.0 — Ultra Baileys + QR

Esta versión modifica únicamente el método de conexión:

- Restaura Ultra Baileys (`russellxz/ultra-baileys`).
- Elimina por completo `requestPairingCode()`.
- Genera e imprime el QR real recibido en `connection.update`.
- Usa `qrcode-terminal` para que el QR sea visible en SSH/Termux.
- Mantiene IA, cola de edición, TikTok, administración y todos los comandos sin cambios.

Para una vinculación limpia, elimina solo `sessions/principal` antes de iniciar.

## v1.6.1

# Nero Bot v1.6.1

- Restaura exactamente el sistema de vinculación por código que utilizaba la v1.5.3.
- Restaura el manejador estable de mensajes de la v1.5.3 (`resolveChatJid` y `resolveSenderIdentity`).
- Conserva los comandos y módulos de la base actual, incluida la cola/cooldown de edición IA y los créditos de Nero AI.
- Elimina el flujo QR y vuelve a `requestPairingCode()`.
- Usa la misma dependencia Baileys de la v1.5.3: `github:DevYerZx/fsociety-Baileys`.

## v1.6.2

# Nero Bot v1.6.2

Esta versión restaura exactamente el flujo de conexión por código de la v1.5.3 y conserva las funciones agregadas después.

## Correcciones

- `src/index.js` restaurado desde la v1.5.3 estable.
- Todos los imports de Baileys usan `@itsliaaa/baileys` de forma consistente.
- Dependencia fijada a `github:DevYerZx/fsociety-Baileys`, igual que en la v1.5.3.
- Eliminados scripts y parches experimentales de otros forks.
- Conserva IA, NanoBanana, cola y cooldown de edición, créditos, Anime, administración y comandos actuales.

## v1.6.3

# Nero Bot v1.6.3

- Eliminado DevYerZx/fsociety-Baileys.
- Restaurado RussellXZ Ultra Baileys.
- Recuperada la conexión por código original sin fijar versión WA Web.
- Conservadas las funciones actuales, IA, cola y comandos.
## v1.6.6
- Portado a RussellXZ Ultra Baileys únicamente el soporte `sock.sendMessage({ cards })` del generador de mensajes de fsociety-Baileys.
- Ultra continúa administrando la conexión y la vinculación por código; no se instala ni se importa DevYer.
- `.tiktoksearch`, `.testcards` y `.testcardsbtn` usan ahora el flujo directo `cards`.
- El parche se reaplica automáticamente después de cada `npm install` mediante `postinstall`.
- Nuevos comandos Owner: `.restart`, `.ownerinfo`, `.join`, `.leave`, `.block`, `.unblock`, `.setnamebot`, `.setppbot`, `.broadcast`, `.exec` y `.eval`.
