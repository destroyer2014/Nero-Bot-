import config from '../../config.js'

const API_TIMEOUT_MS = 120_000

export class ApiError extends Error {
  constructor(message, status = null, payload = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

export function requireApiKey() {
  const key = process.env.DVYER_API_KEY?.trim()
  if (!key) throw new ApiError('Falta configurar DVYER_API_KEY en el archivo .env del VPS.')
  return key
}

export async function apiGet(endpoint, params = {}, options = {}) {
  const key = requireApiKey()
  const url = new URL(endpoint, config.apiBaseUrl)
  for (const [name, value] of Object.entries({ ...params, apikey: key })) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value))
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || API_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': `${config.botName}/${config.version}` }
    })
    const raw = await response.text()
    let data
    try { data = JSON.parse(raw) } catch { data = { ok: false, message: raw.slice(0, 500) } }
    if (!response.ok || data?.ok === false) {
      throw new ApiError(data?.message || data?.error || `La API respondió HTTP ${response.status}.`, response.status, data)
    }
    return data
  } catch (error) {
    if (error?.name === 'AbortError') throw new ApiError('La API tardó demasiado en responder.')
    throw error
  } finally {
    clearTimeout(timer)
  }
}
