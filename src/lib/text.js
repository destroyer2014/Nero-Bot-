export function unwrapMessage(message = {}) {
  let current = message

  while (current) {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message
      continue
    }

    if (current.viewOnceMessage?.message) {
      current = current.viewOnceMessage.message
      continue
    }

    if (current.viewOnceMessageV2?.message) {
      current = current.viewOnceMessageV2.message
      continue
    }

    if (current.documentWithCaptionMessage?.message) {
      current = current.documentWithCaptionMessage.message
      continue
    }

    break
  }

  return current || {}
}

export function extractText(message = {}) {
  const content = unwrapMessage(message)

  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    content.buttonsResponseMessage?.selectedButtonId ||
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    content.templateButtonReplyMessage?.selectedId ||
    ''
  ).trim()
}
