import {
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  proto
} from '@whiskeysockets/baileys'

function normalizeButtons(buttons = []) {
  return buttons.map(button => {
    if (button?.name && button?.buttonParamsJson) return button
    if (button?.tipo === 'reply') return quickReply(button.texto, button.payload)
    if (button?.tipo === 'url') return urlButton(button.texto, button.payload)
    if (button?.tipo === 'copy') return copyButton(button.texto, button.payload)
    return button
  }).filter(Boolean)
}

async function prepareImage(sock, image) {
  if (!image) return null
  const source = Buffer.isBuffer(image) ? image : image?.url ? image : { url: image }
  const prepared = await prepareWAMessageMedia(
    { image: source },
    { upload: sock.waUploadToServer }
  )
  return prepared.imageMessage || null
}

export async function sendInteractive(sock, chat, { title = '', body = '', footer = 'Nero Bot', media = null, buttons = [] }, quoted) {
  let imageMessage = null
  if (media?.image) {
    try {
      imageMessage = await prepareImage(sock, media.image)
    } catch (error) {
      console.error('[INTERACTIVO] Error preparando imagen:', error?.message || error)
    }
  }

  const messageContent = proto.Message.fromObject({
    viewOnceMessage: {
      message: {
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2
        },
        interactiveMessage: proto.Message.InteractiveMessage.create({
          body: proto.Message.InteractiveMessage.Body.create({ text: body || '' }),
          footer: proto.Message.InteractiveMessage.Footer.create({ text: footer || '' }),
          header: proto.Message.InteractiveMessage.Header.create({
            title: title || '',
            hasMediaAttachment: Boolean(imageMessage),
            imageMessage: imageMessage || null
          }),
          nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
            buttons: normalizeButtons(buttons),
            messageParamsJson: ''
          })
        })
      }
    }
  })

  const message = generateWAMessageFromContent(chat, messageContent, {
    userJid: sock.user?.id || sock.user?.jid,
    quoted
  })
  await sock.relayMessage(chat, message.message, { messageId: message.key.id })
  return message
}

export function quickReply(text, id) {
  return {
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({ display_text: text, id })
  }
}

export function singleSelect(title, sections) {
  return {
    name: 'single_select',
    buttonParamsJson: JSON.stringify({ title, sections })
  }
}

export function urlButton(text, url) {
  return {
    name: 'cta_url',
    buttonParamsJson: JSON.stringify({ display_text: text, url, merchant_url: url })
  }
}

export function copyButton(text, value) {
  return {
    name: 'cta_copy',
    buttonParamsJson: JSON.stringify({ display_text: text, copy_code: value })
  }
}

// Constructor adaptado del carrusel funcional de Yuta-Bot.
// Cada portada se sube primero y su imageMessage se coloca dentro del header.
export async function sendCarousel(sock, chat, { body = '', footer = 'Nero Bot', cards = [], mentions = [] }, quoted) {
  if (!Array.isArray(cards) || !cards.length) throw new Error('No hay resultados para mostrar.')

  const preparedCards = []
  for (const [index, card] of cards.slice(0, 10).entries()) {
    let imageMessage = null
    if (card.image) {
      try {
        const media = await prepareWAMessageMedia(
          { image: Buffer.isBuffer(card.image) ? card.image : card.image?.url ? card.image : { url: card.image } },
          { upload: sock.waUploadToServer }
        )
        imageMessage = media.imageMessage || null
      } catch (error) {
        console.error(`[CARRUSEL] Error preparando portada ${index + 1}:`, error?.message || error)
      }
    }

    if (!imageMessage) continue

    preparedCards.push(proto.Message.InteractiveMessage.create({
      header: proto.Message.InteractiveMessage.Header.create({
        title: card.title || '',
        hasMediaAttachment: true,
        imageMessage
      }),
      body: proto.Message.InteractiveMessage.Body.create({ text: card.body || '' }),
      footer: proto.Message.InteractiveMessage.Footer.create({ text: card.footer || footer || '' }),
      nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
        buttons: normalizeButtons(card.buttons || []),
        messageParamsJson: ''
      })
    }))
  }

  if (!preparedCards.length) throw new Error('No pude preparar ninguna portada para el carrusel.')

  const messageContent = proto.Message.fromObject({
    viewOnceMessage: {
      message: {
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2
        },
        interactiveMessage: proto.Message.InteractiveMessage.create({
          body: proto.Message.InteractiveMessage.Body.create({ text: body || '' }),
          footer: proto.Message.InteractiveMessage.Footer.create({ text: footer || '' }),
          header: proto.Message.InteractiveMessage.Header.create({ hasMediaAttachment: false }),
          carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.create({
            cards: preparedCards,
            messageVersion: 1
          }),
          contextInfo: mentions.length ? { mentionedJid: mentions } : undefined
        })
      }
    }
  })

  const message = generateWAMessageFromContent(chat, messageContent, {
    userJid: sock.user?.jid || sock.user?.id,
    quoted
  })
  await sock.relayMessage(chat, message.message, { messageId: message.key.id })
  return message
}
