import {
  WAProto as proto,
  prepareWAMessageMedia,
  generateWAMessageFromContent
} from '@itsliaaa/baileys'
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
