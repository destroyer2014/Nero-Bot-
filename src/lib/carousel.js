import {
  WAProto as proto,
  prepareWAMessageMedia,
  generateWAMessageFromContent
} from '@itsliaaa/baileys'

function mapButtons(buttons = []) {
  const output = []
  for (const button of buttons || []) {
    if (!button) continue
    if (button.name && button.buttonParamsJson) {
      output.push(button)
    } else if (button.tipo === 'reply') {
      output.push({
        name: 'quick_reply',
        buttonParamsJson: JSON.stringify({ display_text: button.texto, id: button.payload })
      })
    } else if (button.tipo === 'url') {
      output.push({
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({ display_text: button.texto, url: button.payload, merchant_url: button.payload })
      })
    } else if (button.tipo === 'copy') {
      output.push({
        name: 'cta_copy',
        buttonParamsJson: JSON.stringify({ display_text: button.texto || 'Copiar', copy_code: button.payload })
      })
    }
  }
  return output
}

function resolveImage(card) {
  return card.image || card.img || null
}

export async function sendCarousel(
  sock,
  jid,
  {
    body = '',
    footer = 'Nero Bot',
    cards = [],
    cardLimit = 10
  } = {},
  quoted = null
) {
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error('El carrusel necesita al menos una tarjeta.')
  }

  const preparedCards = []

  for (const card of cards.slice(0, cardLimit)) {
    let imageMessage = null
    const image = resolveImage(card)

    if (image) {
      try {
        const media = await prepareWAMessageMedia(
          { image: Buffer.isBuffer(image) ? image : (image?.url ? image : { url: image }) },
          { upload: sock.waUploadToServer }
        )
        imageMessage = media.imageMessage
      } catch (error) {
        console.error('[CARRUSEL] Error preparando imagen:', error?.message || error)
      }
    }

    preparedCards.push(proto.Message.InteractiveMessage.create({
      header: proto.Message.InteractiveMessage.Header.create({
        title: card.title || card.titulo || '',
        hasMediaAttachment: Boolean(imageMessage),
        imageMessage: imageMessage || null
      }),
      body: proto.Message.InteractiveMessage.Body.create({
        text: card.body || card.caption || ''
      }),
      footer: proto.Message.InteractiveMessage.Footer.create({
        text: card.footer || footer || ''
      }),
      nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
        buttons: mapButtons(card.buttons || card.botones),
        messageParamsJson: ''
      })
    }))
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
          header: proto.Message.InteractiveMessage.Header.create({ hasMediaAttachment: false }),
          carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.create({
            cards: preparedCards,
            messageVersion: 1
          })
        })
      }
    }
  })

  const userJid = sock.user?.jid || sock.user?.id
  const msg = generateWAMessageFromContent(jid, messageContent, {
    userJid,
    quoted
  })

  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id })
  console.log(`[CARRUSEL] Enviado con ItsLiaaa: ${preparedCards.length} tarjeta(s).`)
  return msg
}
