import { rememberError } from './errorReports.js'

function commandFromText(text = '') {
  return String(text || '').trim().split(/\s+/)[0] || ''
}

export function recordCommandError({
  sender,
  chat,
  text = '',
  command = '',
  error,
  instanceType = 'principal'
} = {}) {
  return rememberError({
    sender,
    chat,
    command: command || commandFromText(text),
    error,
    instanceType
  })
}

export function commandErrorMessage(code = '') {
  return [
    '「⚠️」 *Ha ocurrido un error*',
    '',
    '> 💡 Usa *.reportar* o *.soporte* para reportar el error.',
    code ? `> 🧾 Código: *${code}*` : ''
  ].filter(Boolean).join('\n')
}
