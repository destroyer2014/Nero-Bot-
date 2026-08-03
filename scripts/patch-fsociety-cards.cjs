'use strict'

const fs = require('node:fs')
const path = require('node:path')

const candidates = [
  path.resolve('node_modules/@itsliaaa/baileys/lib/Utils/messages.js'),
  path.resolve('node_modules/@whiskeysockets/baileys/lib/Utils/messages.js')
]

const target = candidates.find(file => fs.existsSync(file))
if (!target) {
  console.warn('[PATCH CARDS] No se encontró messages.js; se omite el parche.')
  process.exit(0)
}

let source = fs.readFileSync(target, 'utf8')
const startNeedle = "    if ('cards' in message && !!message.cards && Array.isArray(message.cards)) {"
const endNeedle = "    if ('shop' in message && !!message.shop) {"
const start = source.indexOf(startNeedle)
const end = source.indexOf(endNeedle, start)

if (start < 0 || end < 0) {
  console.warn('[PATCH CARDS] El fork no contiene el bloque cards esperado; se omite el parche.')
  process.exit(0)
}

const replacement = `    if ('cards' in message && !!message.cards && Array.isArray(message.cards)) {
        const slides = await Promise.all(message.cards.map(async (slide) => {
            var _a, _b, _c, _d;
            // Compatibilidad: cards sin botones y botones como arreglo directo.
            const buttons = Array.isArray(slide === null || slide === void 0 ? void 0 : slide.buttons)
                ? slide.buttons.filter(Boolean)
                : [];
            let headerMedia = {};
            if (slide === null || slide === void 0 ? void 0 : slide.product) {
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
            else if (slide === null || slide === void 0 ? void 0 : slide.image) {
                headerMedia = await (0, exports.prepareWAMessageMedia)({ image: slide.image }, options);
            }
            else if (slide === null || slide === void 0 ? void 0 : slide.video) {
                headerMedia = await (0, exports.prepareWAMessageMedia)({ video: slide.video }, options);
            }
            return {
                header: {
                    title: (_a = slide === null || slide === void 0 ? void 0 : slide.title) !== null && _a !== void 0 ? _a : '',
                    hasMediaAttachment: Object.keys(headerMedia).length > 0,
                    ...headerMedia,
                },
                body: { text: (_b = slide === null || slide === void 0 ? void 0 : slide.body) !== null && _b !== void 0 ? _b : '' },
                footer: { text: (_c = slide === null || slide === void 0 ? void 0 : slide.footer) !== null && _c !== void 0 ? _c : '' },
                nativeFlowMessage: { buttons, messageParamsJson: '' },
            };
        }));
        const interactiveMessage = {
            carouselMessage: { cards: slides, messageVersion: 1 },
        };
        if ('text' in message) interactiveMessage.body = { text: message.text };
        else if ('caption' in message) interactiveMessage.body = { text: message.caption };
        if ('title' in message && !!message.title) {
            interactiveMessage.header = {
                title: message.title,
                subtitle: (_d = message === null || message === void 0 ? void 0 : message.subtitle) !== null && _d !== void 0 ? _d : null,
                hasMediaAttachment: false,
            };
        }
        if ('footer' in message && !!message.footer) interactiveMessage.footer = { text: message.footer };
        if ('contextInfo' in message && !!message.contextInfo) interactiveMessage.contextInfo = message.contextInfo;
        if ('mentions' in message && !!message.mentions) interactiveMessage.contextInfo = { mentionedJid: message.mentions };
        m = { viewOnceMessage: { message: { messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 }, interactiveMessage } } };
    }
`

source = source.slice(0, start) + replacement + source.slice(end)
fs.writeFileSync(target, source)
console.log(`[PATCH CARDS] Carrusel corregido en ${target}`)
