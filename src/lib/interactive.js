import { generateWAMessageFromContent, prepareWAMessageMedia, proto } from '@whiskeysockets/baileys'

export async function sendInteractive(sock, chat, { title = '', body = '', footer = 'Nero Bot', media = null, buttons = [] }, quoted) {
  let header = proto.Message.InteractiveMessage.Header.create({ title, hasMediaAttachment: false })
  if (media?.image) {
    const prepared = await prepareWAMessageMedia({ image: media.image }, { upload: sock.waUploadToServer })
    header = proto.Message.InteractiveMessage.Header.create({
      title,
      hasMediaAttachment: true,
      imageMessage: prepared.imageMessage
    })
  }

  const content = proto.Message.InteractiveMessage.create({
    header,
    body: proto.Message.InteractiveMessage.Body.create({ text: body }),
    footer: proto.Message.InteractiveMessage.Footer.create({ text: footer }),
    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({ buttons })
  })

  const message = generateWAMessageFromContent(chat, {
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage: content
      }
    }
  }, { userJid: sock.user?.id, quoted })

  await sock.relayMessage(chat, message.message, { messageId: message.key.id })
  return message
}

export function quickReply(text, id) {
  return { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: text, id }) }
}

export function singleSelect(title, sections) {
  return { name: 'single_select', buttonParamsJson: JSON.stringify({ title, sections }) }
}

export function urlButton(text, url) {
  return { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: text, url, merchant_url: url }) }
}

export function copyButton(text, value) {
  return { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: text, copy_code: value }) }
}

export async function sendCarousel(sock, chat, { body = '', footer = 'Nero Bot', cards = [] }, quoted) {
  if (!cards.length) throw new Error('No hay resultados para mostrar.')

  const preparedCards = []
  for (const card of cards.slice(0, 10)) {
    let header = proto.Message.InteractiveMessage.Header.create({ title: card.title || '', hasMediaAttachment: false })
    if (card.image) {
      const prepared = await prepareWAMessageMedia({ image: card.image }, { upload: sock.waUploadToServer })
      header = proto.Message.InteractiveMessage.Header.create({
        title: card.title || '',
        hasMediaAttachment: true,
        imageMessage: prepared.imageMessage
      })
    }
    preparedCards.push(proto.Message.InteractiveMessage.create({
      header,
      body: proto.Message.InteractiveMessage.Body.create({ text: card.body || '' }),
      footer: proto.Message.InteractiveMessage.Footer.create({ text: card.footer || footer }),
      nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({ buttons: card.buttons || [] })
    }))
  }

  const content = proto.Message.InteractiveMessage.create({
    body: proto.Message.InteractiveMessage.Body.create({ text: body }),
    footer: proto.Message.InteractiveMessage.Footer.create({ text: footer }),
    carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.create({ cards: preparedCards })
  })

  const message = generateWAMessageFromContent(chat, {
    viewOnceMessage: {
      message: {
        messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
        interactiveMessage: content
      }
    }
  }, { userJid: sock.user?.id, quoted })

  await sock.relayMessage(chat, message.message, { messageId: message.key.id })
  return message
}
