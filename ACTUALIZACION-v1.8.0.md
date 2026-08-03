# Nero Bot v1.8.0

- Base estable con `@itsliaaa/baileys@0.3.18`.
- TikTok Search convertido a lista seleccionable (`.tts`, `.tiktoks`, `.tiktoksearch`).
- Nuevo selector `.ttget` para descargar resultados.
- Subbots por `.code`, administrados como procesos PM2 independientes.
- Aviso automático al grupo al generar código y al completar la vinculación.
- Cooldown de 2 minutos para códigos no vinculados.
- `.bots` muestra estado, uptime y plataforma disponible.
- `.setprincipal` / `.setbot` asigna una instancia principal por grupo.
- Limpieza de sesión y proceso cuando un subbot cierra sesión o usa `.logout`.
- Código único compartido: al actualizar Nero, los subbots cargan los mismos comandos al reiniciarse.
- Nuevo `.reportar`, enviado al Owner y SubOwner.
- Mensajes de error en español con código de seguimiento.
- Nuevo diseño completo de `.menu`, sin dividir categorías.
- Se conservan IA, descargas, moderación, Anti-NSFW, bienvenida, Owner y herramientas.
- Se eliminaron los comandos de prueba de carrusel del registro de comandos.

> Nota: WhatsApp genera el contenido alfanumérico del código de vinculación. Nero personaliza el nombre y mensaje como **NERO**, pero no puede forzar que los caracteres del código sean literalmente “NERO”.
