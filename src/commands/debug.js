import sharp from 'sharp'
import config from '../../config.js'
import { sendCarousel, quickReply, copyButton, urlButton } from '../lib/interactive.js'

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
