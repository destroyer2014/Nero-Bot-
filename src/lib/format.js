export function formatDateTime(timezone) {
  const now = new Date()

  const date = new Intl.DateTimeFormat('es-PE', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(now)

  const time = new Intl.DateTimeFormat('es-PE', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(now)

  return { date, time }
}

export function jidToNumber(jid = '') {
  return jid.split('@')[0].split(':')[0]
}
