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
