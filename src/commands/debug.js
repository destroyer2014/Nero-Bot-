import sharp from 'sharp'
import config from '../../config.js'
import { sendCarousel, sendInteractive, quickReply, copyButton, urlButton, singleSelect } from '../lib/interactive.js'
import { WAProto as proto, generateWAMessageFromContent } from '@whiskeysockets/baileys'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function makeCardImage(label, background) {
  const svg = Buffer.from(`
    <svg width="640" height="640" xmlns="http://www.w3.org/2000/svg">
      <rect width="640" height="640" rx="48" fill="${background}"/>
      <circle cx="320" cy="270" r="150" fill="#ffffff18"/>
      <text x="320" y="285" text-anchor="middle" fill="#ffffff" font-size="76" font-family="sans-serif" font-weight="700">${label}</text>
      <text x="320" y="390" text-anchor="middle" fill="#ffffffcc" font-size="38" font-family="sans-serif">Nero Bot</text>
    </svg>
  `)
  return sharp(svg).jpeg({ quality: 90 }).toBuffer()
}

async function announce(ctx, text) {
  await ctx.sock.sendMessage(ctx.chat, { text }, { quoted: ctx.msg })
}

async function runTest(ctx, number, title, options) {
  const label = `TEST-${number}`
  console.log(`\n[${label}] INICIO: ${title}`)
  await announce(ctx, `🧪 *${label}*\n${title}\n\nConfirma visualmente si aparece.`)
  try {
    await sendCarousel(ctx.sock, ctx.chat, {
      body: `🧪 *${label}* — ${title}`,
      footer: `Nero Bot ${config.botVersion || 'Debug'}`,
      cards: options.cards,
      debugLabel: label,
      messageVersion: options.messageVersion ?? 1,
      cardLimit: 2,
      omitCardFooter: options.omitCardFooter ?? false,
      omitNativeFlowWhenEmpty: options.omitNativeFlowWhenEmpty ?? false
    }, options.quoted ? ctx.msg : null)
    console.log(`[${label}] RELAY OK`)
  } catch (error) {
    console.error(`[${label}] ERROR:`, error)
    await announce(ctx, `❌ *${label}* lanzó error:\n${error?.message || error}`)
  }
  await wait(2500)
}

export const testCarousel = {
  name: 'testcarousel',
  aliases: ['carouseltest'],
  async execute(ctx) {
    const imageA = await makeCardImage('A', '#6d28d9')
    const imageB = await makeCardImage('B', '#be123c')

    await announce(ctx,
      '🔬 *Diagnóstico de carrusel iniciado*\n\n' +
      'Se enviarán 6 pruebas separadas. Revisa cuáles aparecen en WhatsApp. ' +
      'La consola guardará el JSON de cada variante en `logs/carousel-debug/`.'
    )

    await runTest(ctx, 1, '2 tarjetas sin imagen y sin botones', {
      cards: [
        { title: 'Tarjeta A', body: 'Prueba básica sin imagen', buttons: [] },
        { title: 'Tarjeta B', body: 'Prueba básica sin imagen', buttons: [] }
      ],
      omitNativeFlowWhenEmpty: true
    })

    await runTest(ctx, 2, '2 tarjetas con imágenes locales y sin botones', {
      cards: [
        { image: imageA, title: 'Tarjeta A', body: 'Imagen local A', buttons: [] },
        { image: imageB, title: 'Tarjeta B', body: 'Imagen local B', buttons: [] }
      ],
      omitNativeFlowWhenEmpty: true
    })

    await runTest(ctx, 3, 'Imágenes locales + quick_reply', {
      cards: [
        { image: imageA, title: 'Quick A', body: 'Botón de respuesta', buttons: [quickReply('Probar A', `${config.prefix}ping`)] },
        { image: imageB, title: 'Quick B', body: 'Botón de respuesta', buttons: [quickReply('Probar B', `${config.prefix}info`)] }
      ]
    })

    await runTest(ctx, 4, 'Imágenes locales + cta_copy', {
      cards: [
        { image: imageA, title: 'Copy A', body: 'Copia un comando', buttons: [copyButton('Copiar ping', `${config.prefix}ping`)] },
        { image: imageB, title: 'Copy B', body: 'Copia un comando', buttons: [copyButton('Copiar menú', `${config.prefix}menu`)] }
      ]
    })

    await runTest(ctx, 5, 'Imágenes locales + cta_url', {
      cards: [
        { image: imageA, title: 'URL A', body: 'Abre ArcadiaCorps', buttons: [urlButton('Abrir web', 'https://arcadiacorps.online')] },
        { image: imageB, title: 'URL B', body: 'Abre ArcadiaCorps', buttons: [urlButton('Abrir web', 'https://arcadiacorps.online')] }
      ]
    })

    await runTest(ctx, 6, 'Formato TikTok con cta_copy y messageVersion 2', {
      messageVersion: 2,
      cards: [
        { image: imageA, title: '@usuario_a', body: '*Título:* Resultado TikTok A\n*Duración:* 0:20\n*Likes:* 100', buttons: [copyButton('Copiar comando', `${config.prefix}tiktok https://www.tiktok.com/@usuario_a/video/1`)] },
        { image: imageB, title: '@usuario_b', body: '*Título:* Resultado TikTok B\n*Duración:* 0:30\n*Likes:* 200', buttons: [copyButton('Copiar comando', `${config.prefix}tiktok https://www.tiktok.com/@usuario_b/video/2`)] }
      ]
    })

    await announce(ctx,
      '✅ *Diagnóstico terminado*\n\n' +
      'Dime cuáles pruebas viste: 1, 2, 3, 4, 5 o 6. ' +
      'También envíame las líneas de consola `[TEST-x]` si alguna muestra ERROR.'
    )
  }
}


async function runModernTest(ctx, number, title, fn) {
  const label = `MODERN-${number}`
  console.log(`\n[${label}] INICIO: ${title}`)
  await announce(ctx, `🧪 *${label}*\n${title}\n\nConfirma visualmente si aparece.`)
  try {
    const result = await fn()
    console.log(`[${label}] ENVÍO OK:`, result?.key?.id || result || 'sin id')
  } catch (error) {
    console.error(`[${label}] ERROR:`, error)
    await announce(ctx, `❌ *${label}* lanzó error:\n${error?.message || error}`)
  }
  await wait(2500)
}

export const testModernInteractive = {
  name: 'testmodern',
  aliases: ['testnative', 'modernui'],
  async execute(ctx) {
    await announce(ctx,
      '🧬 *Prueba de formatos nativos iniciada*\n\n' +
      'Estas pruebas no son carruseles. Sirven para comprobar qué familias de mensajes interactivos acepta esta sesión/cliente de WhatsApp.'
    )

    await runModernTest(ctx, 1, 'Encuesta nativa enviada con sock.sendMessage', async () => {
      return ctx.sock.sendMessage(ctx.chat, {
        poll: {
          name: '¿Puedes ver esta encuesta de Nero Bot?',
          values: ['Sí, aparece', 'No aparece'],
          selectableCount: 1
        }
      })
    })

    await runModernTest(ctx, 2, 'InteractiveMessage plano con quick_reply', async () => {
      return sendInteractive(ctx.sock, ctx.chat, {
        title: 'Nero Bot',
        body: 'Prueba de mensaje interactivo plano.',
        footer: 'MODERN-2',
        buttons: [quickReply('Probar ping', `${config.prefix}ping`)]
      })
    })

    await runModernTest(ctx, 3, 'InteractiveMessage plano con single_select', async () => {
      return sendInteractive(ctx.sock, ctx.chat, {
        title: 'Nero Bot',
        body: 'Abre la lista y elige una opción.',
        footer: 'MODERN-3',
        buttons: [singleSelect('Seleccionar', [{
          title: 'Pruebas',
          rows: [
            { title: 'Ping', description: 'Ejecuta el comando ping', id: `${config.prefix}ping` },
            { title: 'Menú', description: 'Abre el menú', id: `${config.prefix}menu` }
          ]
        }])]
      })
    })

    await runModernTest(ctx, 4, 'ButtonsMessage clásico (sin InteractiveMessage)', async () => {
      const content = proto.Message.fromObject({
        buttonsMessage: {
          contentText: 'Prueba del formato clásico de botones.',
          footerText: 'MODERN-4',
          headerType: 1,
          buttons: [
            { buttonId: `${config.prefix}ping`, buttonText: { displayText: 'Ping' }, type: 1 },
            { buttonId: `${config.prefix}menu`, buttonText: { displayText: 'Menú' }, type: 1 }
          ]
        }
      })
      const raw = ctx.sock.user?.id || ''
      const userJid = raw.replace(/:\\d+@/, '@')
      const generated = generateWAMessageFromContent(ctx.chat, content, { userJid })
      await ctx.sock.relayMessage(ctx.chat, generated.message, { messageId: generated.key.id })
      return generated
    })

    await runModernTest(ctx, 5, 'ListMessage clásico (sin InteractiveMessage)', async () => {
      const content = proto.Message.fromObject({
        listMessage: {
          title: 'Nero Bot',
          description: 'Prueba de lista clásica.',
          buttonText: 'Abrir lista',
          listType: 1,
          footerText: 'MODERN-5',
          sections: [{
            title: 'Opciones',
            rows: [
              { title: 'Ping', description: 'Ejecuta ping', rowId: `${config.prefix}ping` },
              { title: 'Menú', description: 'Abre el menú', rowId: `${config.prefix}menu` }
            ]
          }]
        }
      })
      const raw = ctx.sock.user?.id || ''
      const userJid = raw.replace(/:\\d+@/, '@')
      const generated = generateWAMessageFromContent(ctx.chat, content, { userJid })
      await ctx.sock.relayMessage(ctx.chat, generated.message, { messageId: generated.key.id })
      return generated
    })

    await announce(ctx,
      '✅ *Prueba moderna terminada*\n\n' +
      'Indica cuáles viste realmente: encuesta 1, botón 2, lista nativa 3, botones clásicos 4 o lista clásica 5.'
    )
  }
}
