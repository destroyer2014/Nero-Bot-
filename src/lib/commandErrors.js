import { rememberError } from './errorReports.js'

function commandFromText(text = '') {
  return String(text || '').trim().split(/\s+/)[0] || ''
}

function cleanMessage(error) {
  return String(error?.message || error || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 700)
}

export function isExpectedCommandError(error) {
  const message = cleanMessage(error)
  if (!message) return false

  return [
    /^Uso:/i,
    /^Este comando /i,
    /^Solo /i,
    /^Debes /i,
    /^Necesitas /i,
    /^Menciona /i,
    /^Responde /i,
    /^Escribe /i,
    /^Ingresa /i,
    /^Selecciona /i,
    /^Selección inválida/i,
    /^La selección /i,
    /^No tienes /i,
    /^No encontré /i,
    /^No se detectaron /i,
    /^El número /i,
    /^Ese número /i,
    /^Esa instancia /i,
    /^El resultado /i,
    /^El usuario /i,
    /^El bot necesita /i,
    /^Nero necesita /i,
    /^Speedtest:/i
  ].some(pattern => pattern.test(message))
}

function isApiError(error) {
  return error?.name === 'ApiError' || Number.isFinite(Number(error?.status))
}

export function recordCommandError({
  sender,
  chat,
  text = '',
  command = '',
  error,
  instanceType = 'principal'
} = {}) {
  // Errores de uso o validación no son fallos internos y no deben llenar
  // el historial de reportes.
  if (isExpectedCommandError(error)) return ''

  return rememberError({
    sender,
    chat,
    command: command || commandFromText(text),
    error,
    instanceType
  })
}

export function commandErrorMessage(code = '', error = null) {
  const message = cleanMessage(error)

  if (isExpectedCommandError(error)) {
    return `❌ ${message}`
  }

  // Los errores que vienen de una API ya están normalizados en api.js.
  // Mostramos su mensaje real sin exponer stack, payload ni secretos.
  if (isApiError(error) && message) {
    return [
      `❌ ${message}`,
      code ? `🧾 Código: *${code}*` : '',
      code ? '> Si persiste usa *.reportar* para enviarlo al equipo.' : ''
    ].filter(Boolean).join('\n')
  }

  return [
    '❌ No se pudo completar el comando por un error interno.',
    code ? `🧾 Código: *${code}*` : '',
    code ? '> Usa *.reportar* o *.soporte* si vuelve a ocurrir.' : ''
  ].filter(Boolean).join('\n')
}
