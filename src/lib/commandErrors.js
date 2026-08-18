import { rememberError } from './errorReports.js'
import {
  diskSpaceUserMessage,
  isDiskSpaceError
} from './diskGuard.js'

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
    /^No pude /i,
    /^La fuente /i,
    /^La descarga /i,
    /^El servidor /i,
    /^El archivo /i,
    /^El video /i,
    /^El audio /i,
    /^No se detectaron /i,
    /^El número /i,
    /^Ese número /i,
    /^Esa instancia /i,
    /^El resultado /i,
    /^El usuario /i,
    /^El bot necesita /i,
    /^Nero necesita /i,
    /^WhatsApp /i,
    /^Speedtest:/i
  ].some(pattern => pattern.test(message))
}

function isApiError(error) {
  return error?.name === 'ApiError' ||
    Number.isFinite(Number(error?.status))
}

function apiFriendlyMessage(error) {
  const status = Number(error?.status || 0)
  const message = cleanMessage(error)

  if (status === 404) {
    return 'No encontré ese contenido o ya no está disponible.'
  }

  if ([400, 422].includes(status)) {
    return 'La solicitud fue rechazada por el servidor. Revisa el enlace o los datos e inténtalo nuevamente.'
  }

  if (status === 429) {
    return 'El servicio está recibiendo demasiadas solicitudes. Espera un momento e inténtalo otra vez.'
  }

  if ([500, 502, 503, 504].includes(status)) {
    return 'El servicio externo está temporalmente inestable. Inténtalo nuevamente en unos minutos.'
  }

  if (/HTTP\s+\d{3}/i.test(message)) {
    return 'El servicio externo no pudo completar la solicitud. Inténtalo nuevamente.'
  }

  return message ||
    'El servicio externo no pudo completar la solicitud.'
}

function processFriendlyMessage(error) {
  const message = cleanMessage(error)

  if (isDiskSpaceError(error)) {
    return diskSpaceUserMessage()
  }

  if (/ffmpeg|ffprobe/i.test(message)) {
    return [
      '❌ No pude procesar el archivo multimedia.',
      '',
      'El conversor de video/audio del servidor encontró un problema.',
      '> Intenta nuevamente. Si persiste, usa *.soporte*.'
    ].join('\n')
  }

  if (
    /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(
      message
    )
  ) {
    return [
      '❌ La descarga perdió conexión con el servidor externo.',
      '',
      '> Intenta nuevamente dentro de unos minutos.'
    ].join('\n')
  }

  if (/excede|supera el máximo|demasiado grande/i.test(message)) {
    return `❌ ${message}`
  }

  return [
    '❌ No se pudo completar el comando.',
    '',
    'El proceso encontró un error temporal.',
    '> Intenta nuevamente. Si vuelve a ocurrir, usa *.soporte*.'
  ].join('\n')
}

export function recordCommandError({
  sender,
  chat,
  text = '',
  command = '',
  error,
  instanceType = 'principal'
} = {}) {
  if (isExpectedCommandError(error)) return ''

  return rememberError({
    sender,
    chat,
    command: command || commandFromText(text),
    error,
    instanceType
  })
}

export function commandErrorMessage(
  _code = '',
  error = null
) {
  const message = cleanMessage(error)

  if (isDiskSpaceError(error)) {
    return diskSpaceUserMessage()
  }

  if (isExpectedCommandError(error)) {
    return `❌ ${message}`
  }

  if (isApiError(error)) {
    return [
      `❌ ${apiFriendlyMessage(error)}`,
      '',
      '> Intenta nuevamente. Si el problema continúa, usa *.soporte*.'
    ].join('\n')
  }

  return processFriendlyMessage(error)
}
