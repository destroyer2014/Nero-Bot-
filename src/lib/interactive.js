import {
  WAProto as proto,
  prepareWAMessageMedia,
  generateWAMessageFromContent
} from '@whiskeysockets/baileys'
import fs from 'node:fs/promises'
import path from 'node:path'

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
// pertenecen todos al mismo fork @whiskeysockets/baileys rc.9.
export async function sendCarousel(
  sock,
  chat,
  {
    body = '',
    footer = 'Nero Bot',
    cards = [],
    mentions = [],
    debugLabel = 'CARRUSEL',
    messageVersion = 1,
    cardLimit = 10,
    omitCardFooter = false,
    omitNativeFlowWhenEmpty = false,
    banner = null,
    bannerTitle = ''
  },
  quoted = null
) {
  if (!Array.isArray(cards) || !cards.length) {
    throw new Error('No hay resultados para mostrar.')
  }

  const preparedCards = []

  for (const card of cards.slice(0, cardLimit)) {
    let imageMessage = null
    if (card.image) {
      try {
        const media = await prepareWAMessageMedia(
          { image: Buffer.isBuffer(card.image) ? card.image : card.image?.url ? card.image : { url: card.image } },
          { upload: sock.waUploadToServer }
        )
        imageMessage = media.imageMessage
      } catch (error) {
        console.error(`[${debugLabel}] Error imagen:`, error?.message || error)
      }
    }

    const normalizedButtons = normalizeButtons(card.buttons || [])
    const cardFields = {
      header: proto.Message.InteractiveMessage.Header.create({
        title: card.title || '',
        hasMediaAttachment: Boolean(imageMessage),
        imageMessage: imageMessage || null
      }),
      body: proto.Message.InteractiveMessage.Body.create({ text: card.body || '' })
    }

    if (!omitCardFooter) {
      cardFields.footer = proto.Message.InteractiveMessage.Footer.create({ text: card.footer || footer || '' })
    }
    if (!(omitNativeFlowWhenEmpty && normalizedButtons.length === 0)) {
      cardFields.nativeFlowMessage = proto.Message.InteractiveMessage.NativeFlowMessage.create({
        buttons: normalizedButtons,
        messageParamsJson: ''
      })
    }

    preparedCards.push(proto.Message.InteractiveMessage.create(cardFields))
  }

  let bannerImageMessage = null
  if (banner) {
    try {
      const preparedBanner = await prepareWAMessageMedia(
        { image: Buffer.isBuffer(banner) ? banner : banner?.url ? banner : { url: banner } },
        { upload: sock.waUploadToServer }
      )
      bannerImageMessage = preparedBanner.imageMessage
    } catch (error) {
      console.error(`[${debugLabel}] Error banner:`, error?.message || error)
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
            title: bannerTitle || '',
            hasMediaAttachment: Boolean(bannerImageMessage),
            imageMessage: bannerImageMessage || null
          }),
          carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.create({
            cards: preparedCards,
            messageVersion
          }),
          contextInfo: mentions.length ? { mentionedJid: mentions } : undefined
        })
      }
    }
  })

  const rawUserJid = sock.user?.jid || sock.user?.id || ''
  const normalizedUserJid = rawUserJid.replace(/:\d+@/, '@')
  const generated = generateWAMessageFromContent(chat, messageContent, {
    userJid: normalizedUserJid || rawUserJid,
    quoted
  })

  const safeLabel = String(debugLabel || 'CARRUSEL').replace(/[^a-z0-9_-]/gi, '_')
  const debugDir = path.resolve('logs', 'carousel-debug')
  await fs.mkdir(debugDir, { recursive: true }).catch(() => {})
  const debugFile = path.join(debugDir, `${Date.now()}-${safeLabel}.json`)
  await fs.writeFile(debugFile, JSON.stringify({
    label: debugLabel,
    chat,
    cardCount: preparedCards.length,
    messageVersion,
    hasBanner: Boolean(bannerImageMessage),
    socketUser: sock.user,
    normalizedUserJid,
    messageId: generated.key?.id,
    message: generated.message
  }, null, 2)).catch(error => console.error(`[${debugLabel}] No se pudo guardar JSON:`, error?.message || error))

  console.log(`[${debugLabel}] JID:`, chat)
  console.log(`[${debugLabel}] Tarjetas:`, preparedCards.length)
  console.log(`[${debugLabel}] messageVersion:`, messageVersion)
  console.log(`[${debugLabel}] userJid normalizado:`, normalizedUserJid)
  console.log(`[${debugLabel}] Message ID:`, generated.key?.id)
  console.log(`[${debugLabel}] JSON:`, debugFile)

  try {
    const result = await sock.relayMessage(chat, generated.message, { messageId: generated.key.id })
    console.log(`[${debugLabel}] relayMessage OK:`, result)
  } catch (error) {
    console.error(`[${debugLabel}] relayMessage ERROR:`, error)
    throw error
  }

  return generated
}

