const DEFAULT_BASE_URL = 'https://dniruc.apisperu.com/api/v1/'
const DEFAULT_TIMEOUT_MS = 20_000

export class ApisPeruError extends Error {
  constructor(message, status = null) {
    super(message)
    this.name = 'ApisPeruError'
    this.status = status
  }
}

function requireToken() {
  const token = process.env.APISPERU_TOKEN?.trim()
  if (!token) throw new ApisPeruError('Falta configurar APISPERU_TOKEN en el archivo .env del VPS.')
  return token
}

const digits = value => String(value || '').replace(/\D/g, '')

export function validateDni(value = '') {
  const dni = digits(value)
  if (!/^\d{8}$/.test(dni)) throw new ApisPeruError('El DNI debe tener exactamente 8 dígitos.')
  return dni
}

export function validateRuc(value = '') {
  const ruc = digits(value)
  if (!/^\d{11}$/.test(ruc)) throw new ApisPeruError('El RUC debe tener exactamente 11 dígitos.')
  return ruc
}

async function get(pathname) {
  const url = new URL(pathname.replace(/^\/+/, ''), process.env.APISPERU_BASE_URL?.trim() || DEFAULT_BASE_URL)
  url.searchParams.set('token', requireToken())

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'Nero-Bot/APIsPERU' }
    })

    const raw = await response.text()
    let data
    try { data = JSON.parse(raw) }
    catch { throw new ApisPeruError('APIsPERU devolvió una respuesta no válida.', response.status) }

    const message = data?.message || data?.error || data?.mensaje || data?.errors?.[0]?.message
    if (!response.ok || data?.success === false || data?.ok === false || data?.status === false) {
      throw new ApisPeruError(message || `APIsPERU respondió HTTP ${response.status}.`, response.status)
    }

    return data?.data && typeof data.data === 'object' ? data.data : data
  } catch (error) {
    if (error?.name === 'AbortError') throw new ApisPeruError('APIsPERU tardó demasiado en responder.')
    if (error instanceof ApisPeruError) throw error
    throw new ApisPeruError('No se pudo conectar con APIsPERU.')
  } finally {
    clearTimeout(timer)
  }
}

export async function lookupDni(value) {
  const dni = validateDni(value)
  return get(`dni/${dni}`)
}

export async function lookupRuc(value) {
  const ruc = validateRuc(value)
  return get(`ruc/${ruc}`)
}
