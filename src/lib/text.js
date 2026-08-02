export function unwrapMessage(message = {}) {
  let current = message
  while (current) {
    if (current.ephemeralMessage?.message) { current = current.ephemeralMessage.message; continue }
    if (current.viewOnceMessage?.message) { current = current.viewOnceMessage.message; continue }
    if (current.viewOnceMessageV2?.message) { current = current.viewOnceMessageV2.message; continue }
    if (current.documentWithCaptionMessage?.message) { current = current.documentWithCaptionMessage.message; continue }
    break
  }
  return current || {}
}

function findCommandId(value) {
  if (!value) return ''
  if (typeof value === 'string') {
    const text = value.trim()
    if (text.startsWith('.')) return text
    try { return findCommandId(JSON.parse(text)) } catch { return '' }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCommandId(item)
      if (found) return found
    }
    return ''
  }
  if (typeof value === 'object') {
    const preferred = [
      value.id,
      value.selectedId,
      value.selected_id,
      value.row_id,
      value.rowId,
      value.button_id,
      value.buttonId,
      value.command
    ]
    for (const candidate of preferred) {
      const found = findCommandId(candidate)
      if (found) return found
    }
    for (const nested of Object.values(value)) {
      const found = findCommandId(nested)
      if (found) return found
    }
  }
  return ''
}

function nativeFlowId(content) {
  const response = content.interactiveResponseMessage
  if (!response) return ''

  const raw = response.nativeFlowResponseMessage?.paramsJson
  const fromParams = findCommandId(raw)
  if (fromParams) return fromParams

  return findCommandId(response)
}

export function extractText(message = {}) {
  const content = unwrapMessage(message)

  // Las respuestas de listas/botones pueden incluir también el título visible
  // como extendedTextMessage. El ID interno debe tener prioridad para ejecutar
  // el comando real, por ejemplo: .spotifypick <token> <índice>.
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
