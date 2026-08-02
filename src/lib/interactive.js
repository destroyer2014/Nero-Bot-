import {
  WAProto as proto,
  prepareWAMessageMedia,
  generateWAMessageFromContent
} from '@itsliaaa/baileys'

function normalizeButtons(buttons = []) {
  const mapped = []
  for (const button of buttons || []) {
    if (button?.name && button?.buttonParamsJson) {
      mapped.push(button)
    } else if (button?.tipo === 'reply') {
      mapped.push(quickReply(button.texto, button.payload))
    } else if (button?.tipo === 'url') {
      mapped.push(urlButton(button.texto, button.payload))
    } else if (button?.tipo === 'copy') {
      mapped.push(copyButton(button.texto, button.payload))
    }
  }
  return mapped
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

export async function sendInteractive(
  sock,
  chat,
  { title = '', body = '', footer = 'Nero Bot', media = null, buttons = [], mentions = [] },
  quoted = null
) {
  let imageMessage = null
  if (media?.image) {
    try {
      const prepared = await prepareWAMessageMedia(
        { image: Buffer.isBuffer(media.image) ? media.image : media.image?.url ? media.image : { url: media.image } },
        { upload: sock.waUploadToServer }
      )
      imageMessage = prepared.imageMessage
    } catch (error) {
      console.error('[INTERACTIVO] Error imagen:', error?.message || error)
    }
  }

  const messageContent = proto.Message.fromObject({
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
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
          }),
          contextInfo: mentions.length ? { mentionedJid: mentions } : undefined
        })
      }
    }
  })

  const generated = generateWAMessageFromContent(chat, messageContent, {
    userJid: sock.user?.jid,
    quoted
  })
  await sock.relayMessage(chat, generated.message, { messageId: generated.key.id })
  return generated
}

// Implementación portada directamente desde Yuta-Bot.
// Socket, WAProto, prepareWAMessageMedia y generateWAMessageFromContent
// pertenecen todos al mismo fork @itsliaaa/baileys rc.9.
export async function sendCarousel(
  sock,
  chat,
  { body = '', footer = 'Nero Bot', cards = [], mentions = [] },
  quoted = null
) {
  if (!Array.isArray(cards) || !cards.length) {
    throw new Error('No hay resultados para mostrar.')
  }

  const preparedCards = []

  for (const card of cards.slice(0, 10)) {
    let imageMessage = null
    if (card.image) {
      try {
        const media = await prepareWAMessageMedia(
          { image: Buffer.isBuffer(card.image) ? card.image : card.image?.url ? card.image : { url: card.image } },
          { upload: sock.waUploadToServer }
        )
        imageMessage = media.imageMessage
      } catch (error) {
        console.error('[CARRUSEL] Error imagen:', error?.message || error)
      }
    }

    preparedCards.push(proto.Message.InteractiveMessage.create({
      header: proto.Message.InteractiveMessage.Header.create({
        title: card.title || '',
        hasMediaAttachment: Boolean(imageMessage),
        imageMessage: imageMessage || null
      }),
      body: proto.Message.InteractiveMessage.Body.create({ text: card.body || '' }),
      footer: proto.Message.InteractiveMessage.Footer.create({ text: card.footer || footer || '' }),
      nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
        buttons: normalizeButtons(card.buttons || []),
        messageParamsJson: ''
      })
    }))
  }

  const messageContent = proto.Message.fromObject({
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
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

  const generated = generateWAMessageFromContent(chat, messageContent, {
    userJid: sock.user?.jid || sock.user?.id,
    quoted
  })

  console.log('[CARRUSEL] JID:', chat)
  console.log('[CARRUSEL] Tarjetas:', preparedCards.length)
  console.log('[CARRUSEL] Socket user:', sock.user)
  console.log('[CARRUSEL] Message ID:', generated.key?.id)
  console.log('[CARRUSEL] Mensaje generado:', JSON.stringify(generated.message, null, 2))

  try {
    const result = await sock.relayMessage(chat, generated.message, { messageId: generated.key.id })
    console.log('[CARRUSEL] relayMessage OK:', result)
  } catch (error) {
    console.error('[CARRUSEL] relayMessage ERROR:', error)
    throw error
  }

  return generated
}
