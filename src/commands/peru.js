import { lookupDni, lookupRuc } from '../lib/apisperu.js'

const text = value => String(value ?? '').trim()
const show = value => text(value) || 'No disponible'

function list(value) {
  if (!Array.isArray(value)) return show(value)
  const items = value.map(text).filter(Boolean)
  return items.length ? items.join(', ') : 'No disponible'
}

function location(data = {}) {
  const parts = [data.departamento, data.provincia, data.distrito].map(text).filter(Boolean)
  return parts.length ? parts.join(' / ') : 'No disponible'
}

export const dniCommand = {
  name: 'dni',
  aliases: ['consultardni'],
  description: 'Consulta información pública asociada a un DNI peruano.',
  async execute(ctx) {
    const input = ctx.args.join('').replace(/\D/g, '')
    if (!input) throw new Error('Uso: .dni <8 dígitos>')

    const data = await lookupDni(input)
    const dni = data.dni || data.numero || input
    const nombres = data.nombres || ''
    const paterno = data.apellidoPaterno || data.apellido_paterno || ''
    const materno = data.apellidoMaterno || data.apellido_materno || ''
    const fullName = data.nombreCompleto || data.nombre_completo || [nombres, paterno, materno].filter(Boolean).join(' ')
    const verification = data.codVerifica || data.codigo_verificacion || data.codigoVerificacion || ''

    const body = [
      '🪪 *CONSULTA DNI • PERÚ*', '',
      `*DNI:* ${show(dni)}`,
      `*Nombre completo:* ${show(fullName)}`,
      `*Nombres:* ${show(nombres)}`,
      `*Apellido paterno:* ${show(paterno)}`,
      `*Apellido materno:* ${show(materno)}`,
      `*Código de verificación:* ${show(verification)}`,
      '', '_Fuente: APIsPERU_'
    ].join('\n')

    await ctx.sock.sendMessage(ctx.chat, { text: body }, { quoted: ctx.msg })
  }
}

export const rucCommand = {
  name: 'ruc',
  aliases: ['consultaruc'],
  description: 'Consulta información pública de un RUC peruano.',
  async execute(ctx) {
    const input = ctx.args.join('').replace(/\D/g, '')
    if (!input) throw new Error('Uso: .ruc <11 dígitos>')

    const data = await lookupRuc(input)
    const razonSocial = data.razonSocial || data.nombre_o_razon_social || data.razon_social || ''
    const nombreComercial = data.nombreComercial || data.nombre_comercial || ''
    const direccion = data.direccion_completa || data.direccion || ''
    const ubigeo = data.ubigeo_sunat || data.ubigeo || ''

    const body = [
      '🏢 *CONSULTA RUC • PERÚ*', '',
      `*RUC:* ${show(data.ruc || input)}`,
      `*Razón social:* ${show(razonSocial)}`,
      `*Nombre comercial:* ${show(nombreComercial)}`,
      `*Estado:* ${show(data.estado)}`,
      `*Condición:* ${show(data.condicion)}`,
      `*Dirección:* ${show(direccion)}`,
      `*Ubicación:* ${location(data)}`,
      `*Ubigeo:* ${list(ubigeo)}`,
      `*Teléfonos:* ${list(data.telefonos)}`,
      `*Capital:* ${show(data.capital)}`,
      '', '_Fuente: APIsPERU / SUNAT_'
    ].join('\n')

    await ctx.sock.sendMessage(ctx.chat, { text: body }, { quoted: ctx.msg })
  }
}

export const peruLookupCommands = [dniCommand, rucCommand]
