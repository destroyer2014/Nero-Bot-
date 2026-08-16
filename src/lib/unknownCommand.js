export function unknownCommandMessage(raw = '', prefix = '.', suggestion = '') {
  const name = String(raw || '').trim().replace(/^[.!/#]+/, '') || 'comando'
  const menu = `${prefix || '.'}menu`

  return [
    '「❓」 *COMANDO NO ENCONTRADO*',
    '',
    `*${name}* no existe.`,
    '',
    suggestion
      ? `> _¿Quisiste decir *${suggestion}*? Usa el menú para ver todos los comandos._`
      : `> _Usa *${menu}* para ver todos los comandos._`
  ].join('\n')
}
