import {
  WAProto as proto,
  prepareWAMessageMedia,
  generateWAMessageFromContent,
  WA_DEFAULT_EPHEMERAL
} from '@whiskeysockets/baileys'

function normalizeButtons(buttons = []) {
  const result = []
  for (const button of buttons || []) {
    if (button?.name && button?.buttonParamsJson) result.push(button)
    else if (button?.tipo === 'reply') result.push({
      name: 'quick_reply',
      buttonParamsJson: JSON.stringify({ display_text: button.texto, id: button.payload })
    })
    else if (button?.tipo === 'url') result.push({
      name: 'cta_url',
      buttonParamsJson: JSON.stringify({ display_text: button.texto, url: button.payload, merchant_url: button.payload })
    })
    else if (button?.tipo === 'copy') result.push({
      name: 'cta_copy',
      buttonParamsJson: JSON.stringify({ display_text: button.texto || 'Copiar', copy_code: button.payload })
    })
  }
  return result
}

function mediaInput(value, type = 'image') {
  if (Buffer.isBuffer(value)) return { [type]: value }
  if (value?.url) return { [type]: value }
  return { [type]: { url: value } }
}

async function prepareCardMedia(sock, card, options) {
  if (card.image) {
    return prepareWAMessageMedia(mediaInput(card.image, 'image'), {
      upload: sock.waUploadToServer,
      ...options
    })
  }
  if (card.video) {
    return prepareWAMessageMedia(mediaInput(card.video, 'video'), {
      upload: sock.waUploadToServer,
      ...options
    })
  }
  return {}
}

/**
 * Carrusel protobuf adaptado del simple.js funcional del otro bot.
 * No modifica Ultra Baileys ni depende de sendMessage({ cards }).
 */
export async function sendCarousel(
  sock,
  jid,
  {
    body = '',
    footer = 'Nero Bot',
    cards = [],
    mentions = [],
    messageVersion = 1,
    cardLimit = 10
  } = {},
  quoted = null,
  options = {}
) {
  if (!Array.isArray(cards) || cards.length < 2) {
    throw new Error('El carrusel necesita al menos dos tarjetas.')
  }

  const preparedCards = await Promise.all(cards.slice(0, cardLimit).map(async card => {
    const media = await prepareCardMedia(sock, card, options)
    const buttons = normalizeButtons(card.buttons)

    return proto.Message.InteractiveMessage.create({
      body: proto.Message.InteractiveMessage.Body.fromObject({
        text: card.body || ''
      }),
      footer: proto.Message.InteractiveMessage.Footer.fromObject({
        text: card.footer || footer || ''
      }),
      header: proto.Message.InteractiveMessage.Header.fromObject({
        title: card.title || '',
        subtitle: card.subtitle || '',
        hasMediaAttachment: Boolean(media.imageMessage || media.videoMessage),
        imageMessage: media.imageMessage || null,
        videoMessage: media.videoMessage || null
      }),
      nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
        buttons,
        messageParamsJson: ''
      }),
      contextInfo: mentions.length ? { mentionedJid: mentions } : undefined
    })
  }))

  const interactiveMessage = proto.Message.InteractiveMessage.create({
    body: proto.Message.InteractiveMessage.Body.fromObject({ text: body || '' }),
    footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: footer || '' }),
    header: proto.Message.InteractiveMessage.Header.fromObject({
      title: '',
      subtitle: '',
      hasMediaAttachment: false
    }),
    carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({
      cards: preparedCards,
      messageVersion
    }),
    contextInfo: mentions.length ? { mentionedJid: mentions } : undefined
  })

  const messageContent = proto.Message.fromObject({
    viewOnceMessage: {
      message: {
        messageContextInfo: {
          deviceListMetadata: {},
          deviceListMetadataVersion: 2
        },
        interactiveMessage
      }
    }
  })

  const rawUserJid = sock.user?.jid || sock.user?.id || ''
  const userJid = rawUserJid.replace(/:\d+@/, '@')
  const generated = generateWAMessageFromContent(jid, messageContent, {
    userJid: userJid || rawUserJid,
    quoted,
    upload: sock.waUploadToServer,
    ephemeralExpiration: WA_DEFAULT_EPHEMERAL,
    ...options
  })

  await sock.relayMessage(jid, generated.message, { messageId: generated.key.id })
  return generated
}
