'use strict'

const fs = require('node:fs')
const path = require('node:path')

const messagesFile = path.join(
  process.cwd(),
  'node_modules',
  '@whiskeysockets',
  'baileys',
  'lib',
  'Utils',
  'messages.js'
)

const START = '/* NERO_ULTRA_CARDS_PATCH_START */'
const END = '/* NERO_ULTRA_CARDS_PATCH_END */'

const patch = `${START}
    if ('cards' in message && !!message.cards && Array.isArray(message.cards)) {
        const slides = await Promise.all(message.cards.map(async (slide) => {
            const buttons = Array.isArray(slide?.buttons) ? slide.buttons : [];
            let headerMedia = {};
            if (slide?.product) {
                const { imageMessage } = await (0, exports.prepareWAMessageMedia)({ image: slide.product.productImage }, options);
                headerMedia = {
                    productMessage: {
                        product: {
                            ...slide.product,
                            productImage: imageMessage,
                        },
                    },
                };
            }
            else if (slide?.image) {
                headerMedia = await (0, exports.prepareWAMessageMedia)({ image: slide.image }, options);
            }
            else if (slide?.video) {
                headerMedia = await (0, exports.prepareWAMessageMedia)({ video: slide.video }, options);
            }
            return {
                header: {
                    title: slide?.title ?? '',
                    hasMediaAttachment: Object.keys(headerMedia).length > 0,
                    ...headerMedia,
                },
                body: {
                    text: slide?.body ?? '',
                },
                footer: {
                    text: slide?.footer ?? '',
                },
                nativeFlowMessage: {
                    buttons,
                },
            };
        }));
        const interactiveMessage = {
            carouselMessage: {
                cards: slides,
                messageVersion: Number(message.messageVersion || 1),
            },
        };
        if ('text' in message) {
            interactiveMessage.body = { text: message.text };
        }
        else if ('caption' in message) {
            interactiveMessage.body = { text: message.caption };
        }
        if ('title' in message && !!message.title) {
            interactiveMessage.header = {
                title: message.title,
                subtitle: message?.subtitle ?? null,
                hasMediaAttachment: false,
            };
        }
        if ('footer' in message && !!message.footer) {
            interactiveMessage.footer = { text: message.footer };
        }
        if ('contextInfo' in message && !!message.contextInfo) {
            interactiveMessage.contextInfo = message.contextInfo;
        }
        if ('mentions' in message && !!message.mentions) {
            interactiveMessage.contextInfo = { mentionedJid: message.mentions };
        }
        m = { interactiveMessage };
    }
${END}`

function fail(message) {
  console.error(`[NERO CARDS] ${message}`)
  process.exitCode = 1
}

if (!fs.existsSync(messagesFile)) {
  fail(`No se encontró ${messagesFile}`)
  return
}

let source = fs.readFileSync(messagesFile, 'utf8')
if (source.includes(START) && source.includes(END)) {
  console.log('[NERO CARDS] El soporte de carrusel ya estaba instalado.')
  return
}

const markers = [
  "    if ('shop' in message && !!message.shop) {",
  "    if ('viewOnce' in message && !!message.viewOnce) {"
]
const marker = markers.find((candidate) => source.includes(candidate))
if (!marker) {
  fail('No se encontró un punto seguro para insertar el soporte de cards.')
  return
}

source = source.replace(marker, `${patch}\n${marker}`)
fs.writeFileSync(messagesFile, source)

const verified = fs.readFileSync(messagesFile, 'utf8')
if (!verified.includes(START) || !verified.includes("carouselMessage")) {
  fail('La verificación del parche falló.')
  return
}

console.log(`[NERO CARDS] Carrusel instalado en ${messagesFile}`)
