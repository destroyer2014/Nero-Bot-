# Nero Bot

Bot de WhatsApp construido con `@whiskeysockets/baileys` 7.0.0-rc13.

## Requisitos

- Node.js 20 o superior
- Una cuenta de WhatsApp capaz de vincular dispositivos
- Internet

## Instalación

```bash
npm install
npm start
```

Al iniciar por primera vez, escribe el número completo con código de país, sin `+`, espacios ni guiones.

Ejemplo para Perú:

```text
51987654321
```

Luego abre en el teléfono:

1. WhatsApp
2. Dispositivos vinculados
3. Vincular un dispositivo
4. Vincular con número de teléfono
5. Ingresa el código mostrado por Nero Bot

## Comandos

- `.menu`
- `.ping`
- `.info`

## Principal o subbot

Edita `config.js`:

```js
instanceType: 'principal'
```

Para una instancia secundaria:

```js
sessionName: 'subbot-1',
instanceType: 'subbot'
```

Cada `sessionName` usa una carpeta de sesión diferente.

## Dueños y permisos

Los números autorizados están configurados en `config.js`, siempre con código de país y solo dígitos:

```js
ownerNumbers: ['51917611323'],
subOwnerNumbers: ['51921909260']
```

Los comandos reciben estas propiedades para aplicar permisos:

- `isOwner`: únicamente el owner principal.
- `isSubOwner`: únicamente el subowner.
- `isStaff`: owner o subowner.
- `permissionLevel`: `owner`, `subowner` o `user`.
