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
