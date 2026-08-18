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

function commandIdFromValue(value) {
  if (!value) return ''

  if (typeof value === 'string') {
    const text = value.trim()
    if (text.startsWith('.')) return text

    try {
      return commandIdFromValue(JSON.parse(text))
    } catch {
      return ''
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = commandIdFromValue(item)
      if (found) return found
    }
    return ''
  }

  if (typeof value === 'object') {
    for (const key of [
      'id',
      'selectedId',
      'selected_id',
      'row_id',
      'rowId',
      'button_id',
      'buttonId',
      'command'
    ]) {
      const found = commandIdFromValue(value[key])
      if (found) return found
    }

    // Esta recursión es segura porque esta función solo recibe paramsJson,
    // nunca el interactiveResponseMessage/contextInfo completo.
    for (const nested of Object.values(value)) {
      const found = commandIdFromValue(nested)
      if (found) return found
    }
  }

  return ''
}

function nativeFlowId(content) {
  const response = content.interactiveResponseMessage
  if (!response) return ''

  const raw =
    response.nativeFlowResponseMessage?.paramsJson

  // No inspeccionar response/contextInfo completo: allí puede estar el
  // mensaje citado con un comando viejo como ".setbot".
  return commandIdFromValue(raw)
}

export function extractText(message = {}) {
  const content = unwrapMessage(message)

  const interactiveId = nativeFlowId(content)
  if (interactiveId) return interactiveId.trim()

  return (
    content.buttonsResponseMessage?.selectedButtonId ||
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    content.templateButtonReplyMessage?.selectedId ||
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.documentMessage?.caption ||
    ''
  ).trim()
}
