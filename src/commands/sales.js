import fs from 'node:fs'
import path from 'node:path'
import { downloadContentFromMessage } from '@itsliaaa/baileys'
import config from '../../config.js'
import {
  sendInteractive,
  quickReply,
  singleSelect
} from '../lib/interactive.js'
import {
  getSalesGroup,
  withSalesGroup,
  salesMediaDir,
  nextSalesId
} from '../lib/salesStore.js'
import { createCommercialDocument } from '../lib/salesDocuments.js'

const PREFIX = () => config.prefix || '.'
const now = () => Date.now()
const clean = value => String(value ?? '').trim()
const lower = value => clean(value).toLowerCase()
const number = jid => String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '')
const mention = jid => `@${number(jid)}`
const jidKey = jid => {
  const value = String(jid || '')
  const at = value.indexOf('@')
  if (at === -1) return value.split(':')[0]
  return `${value.slice(0, at).split(':')[0]}${value.slice(at)}`
}
const money = (value, currency = 'PEN') =>
  `${currency} ${Number(value || 0).toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`

function assertGroup(ctx) {
  if (!String(ctx.chat || '').endsWith('@g.us')) {
    throw new Error('El sistema de Ventas funciona dentro de grupos.')
  }
}

function contextInfo(msg) {
  return msg?.message?.extendedTextMessage?.contextInfo ||
    msg?.message?.imageMessage?.contextInfo ||
    msg?.message?.videoMessage?.contextInfo ||
    msg?.message?.documentMessage?.contextInfo ||
    null
}

function targetJid(ctx) {
  const info = contextInfo(ctx.msg)
  const mentions = info?.mentionedJid || []
  return mentions[0] || info?.participant || null
}

function normalizeAdminCandidate(value) {
  return String(value || '').split(':')[0]
}

async function isGroupAdmin(ctx) {
  if (ctx.isOwner || ctx.isSubOwner || ctx.isStaff) return true

  try {
    const metadata = await ctx.sock.groupMetadata(ctx.chat)
    const sender = String(ctx.sender || '')
    const senderDigits = number(sender)

    const participant = (metadata?.participants || []).find(item => {
      const candidates = [
        item?.id,
        item?.jid,
        item?.phoneNumber,
        item?.lid
      ].filter(Boolean)

      return candidates.some(value => {
        const text = String(value)
        return text === sender ||
          normalizeAdminCandidate(text) === normalizeAdminCandidate(sender) ||
          (senderDigits && number(text) === senderDigits)
      })
    })

    return Boolean(
      participant?.admin === 'admin' ||
      participant?.admin === 'superadmin'
    )
  } catch {
    return false
  }
}

async function managerOnly(ctx) {
  assertGroup(ctx)
  if (await isGroupAdmin(ctx)) return
  throw new Error('Este comando requiere ser administrador del grupo.')
}

async function sellerOnly(ctx) {
  assertGroup(ctx)
  if (await isGroupAdmin(ctx)) return

  const state = getSalesGroup(ctx.chat)
  const sender = jidKey(ctx.sender)

  if (state.sellers.some(jid => jidKey(jid) === sender)) return
  throw new Error('Este comando requiere ser vendedor o administrador.')
}

function ensureEnabled(state) {
  if (!state.config.enabled) {
    throw new Error(`Ventas está desactivado. Un admin puede usar ${PREFIX()}sales on.`)
  }
}

async function reply(ctx, text, extra = {}) {
  return ctx.sock.sendMessage(
    ctx.chat,
    { text, ...extra },
    { quoted: ctx.msg }
  )
}

function splitPipe(value) {
  return String(value || '')
    .split('|')
    .map(part => part.trim())
}

function getProduct(state, raw) {
  const q = lower(raw)
  if (!q) return null

  return state.products[String(raw).toUpperCase()] ||
    Object.values(state.products).find(product => lower(product.name) === q) ||
    Object.values(state.products).find(product => lower(product.name).includes(q)) ||
    null
}

function activeProducts(state) {
  return Object.values(state.products)
    .filter(product => product.active !== false)
}

function productPrice(product) {
  const offer = Number(product.offerPrice || 0)
  return offer > 0 ? offer : Number(product.price || 0)
}

function customerOf(state, jid) {
  const key = jidKey(jid)

  if (!state.customers[key]) {
    state.customers[key] = {
      jid: key,
      label: mention(key),
      notes: [],
      tags: [],
      createdAt: now(),
      updatedAt: now()
    }
  }

  state.customers[key].updatedAt = now()
  return state.customers[key]
}

function recomputeOrder(order) {
  order.subtotal = (order.items || []).reduce(
    (sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0),
    0
  )

  const discount = Math.max(
    0,
    Math.min(100, Number(order.discountPercent || 0))
  )

  order.total = Math.max(
    0,
    order.subtotal * (1 - discount / 100)
  )

  order.paid = (order.payments || []).reduce(
    (sum, payment) => sum + Number(payment.amount || 0),
    0
  )

  if (order.paid >= order.total && order.total > 0) {
    order.paymentStatus = 'paid'
  } else if (order.paid > 0) {
    order.paymentStatus = 'partial'
  } else {
    order.paymentStatus = 'pending'
  }

  order.updatedAt = now()
  return order
}

function chooseSeller(state, product = null) {
  const sellers = state.sellers || []

  if (product?.seller && sellers.includes(product.seller)) {
    return product.seller
  }

  if (!sellers.length) return null

  if (state.config.assignMode === 'random') {
    return sellers[Math.floor(Math.random() * sellers.length)]
  }

  if (state.config.assignMode === 'manual') return null

  const index = Number(state.config.roundRobinIndex || 0) % sellers.length
  const seller = sellers[index]
  state.config.roundRobinIndex = (index + 1) % sellers.length
  return seller
}

function parseDateValue(raw) {
  const value = clean(raw)
  if (!value) return null

  const current = new Date()
  let base = null
  let time = ''

  const lowerValue = lower(value)

  if (lowerValue.startsWith('hoy')) {
    base = new Date(current)
    time = value.slice(3).trim()
  } else if (
    lowerValue.startsWith('mañana') ||
    lowerValue.startsWith('manana')
  ) {
    base = new Date(current)
    base.setDate(base.getDate() + 1)
    time = value.replace(/^ma(?:ñ|n)ana/i, '').trim()
  } else {
    const match = value.match(
      /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/
    )

    if (match) {
      base = new Date(
        Number(match[3]),
        Number(match[2]) - 1,
        Number(match[1]),
        Number(match[4] || 9),
        Number(match[5] || 0),
        0,
        0
      )
      return base.getTime()
    }

    const iso = value.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/
    )

    if (iso) {
      base = new Date(
        Number(iso[1]),
        Number(iso[2]) - 1,
        Number(iso[3]),
        Number(iso[4] || 9),
        Number(iso[5] || 0),
        0,
        0
      )
      return base.getTime()
    }
  }

  if (!base) return null

  const hm = time.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  let hour = 9
  let minute = 0

  if (hm) {
    hour = Number(hm[1])
    minute = Number(hm[2] || 0)
    const suffix = lower(hm[3])

    if (suffix === 'pm' && hour < 12) hour += 12
    if (suffix === 'am' && hour === 12) hour = 0
  }

  base.setHours(hour, minute, 0, 0)
  return base.getTime()
}

function dateLabel(ms) {
  if (!ms) return 'Sin fecha'
  return new Date(ms).toLocaleString('es-PE', {
    dateStyle: 'short',
    timeStyle: 'short'
  })
}

function statusLabel(status) {
  return {
    new: '🆕 Nuevo',
    interested: '🔥 Interesado',
    contacted: '📞 Contactado',
    negotiating: '🤝 Negociando',
    quoted: '📝 Cotizado',
    payment: '💳 Esperando pago',
    paid: '✅ Pagado',
    lost: '❌ Perdido'
  }[status] || status
}

function orderStatusLabel(status) {
  return {
    pending: '🟡 Pendiente',
    confirmed: '✅ Confirmado',
    preparing: '📦 Preparando',
    shipped: '🚚 Enviado',
    delivered: '📬 Entregado',
    completed: '🏁 Completado',
    cancelled: '❌ Cancelado'
  }[status] || status
}

async function mediaBuffer(ctx, expected) {
  const info = contextInfo(ctx.msg)
  const source =
    info?.quotedMessage ||
    ctx.msg?.message ||
    {}

  const node = expected === 'image'
    ? source.imageMessage
    : source.videoMessage

  if (!node) {
    throw new Error(
      `Responde a un ${expected === 'image' ? 'imagen' : 'video'} con este comando.`
    )
  }

  const stream = await downloadContentFromMessage(node, expected)
  const chunks = []

  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk))
  }

  return Buffer.concat(chunks)
}

async function sendProductCard(ctx, product) {
  const state = getSalesGroup(ctx.chat)
  const currency = state.config.currency
  const price = productPrice(product)

  const lines = [
    `📦 *${product.name}*`,
    '',
    `💰 Precio: ${money(price, currency)}`,
    product.offerPrice
      ? `🏷️ Precio normal: ${money(product.price, currency)}`
      : null,
    `📦 Stock: ${product.stock < 0 ? 'Ilimitado' : product.stock}`,
    `🏷️ Categoría: ${product.category || 'General'}`,
    '',
    product.description || 'Sin descripción.',
    '',
    `🆔 ${product.id}`
  ].filter(Boolean)

  const buttons = [
    quickReply('🛒 Comprar', `${PREFIX()}salesbuy ${product.id}`),
    quickReply('❤️ Me interesa', `${PREFIX()}salesinterest ${product.id}`)
  ]

  if (product.videoPath) {
    buttons.push(
      quickReply('🎥 Ver demo', `${PREFIX()}demo ${product.id}`)
    )
  }

  let image = null

  if (product.imagePath) {
    try { image = fs.readFileSync(product.imagePath) } catch {}
  }

  await sendInteractive(
    ctx.sock,
    ctx.chat,
    {
      title: state.config.businessName,
      body: lines.join('\n'),
      footer: 'Nero Sales',
      media: image ? { image } : null,
      buttons
    },
    ctx.msg
  )
}

async function notifyLead(ctx, lead, product, duplicate = false) {
  if (duplicate) {
    await reply(
      ctx,
      `✅ Ya registramos tu interés en *${product.name}*. Un vendedor podrá atenderte.`,
      { mentions: [ctx.sender] }
    )
    return
  }

  const state = getSalesGroup(ctx.chat)
  const seller = lead.assignedTo
  const mentions = [ctx.sender, ...(seller ? [seller] : [])]

  const message = [
    lead.intent === 'buy'
      ? '🛒 *NUEVA INTENCIÓN DE COMPRA*'
      : '❤️ *NUEVO INTERESADO*',
    '',
    `👤 Cliente: ${mention(ctx.sender)}`,
    `📦 Producto: ${product.name}`,
    `💰 Precio: ${money(productPrice(product), state.config.currency)}`,
    `🔥 Estado: ${statusLabel(lead.status)}`,
    seller
      ? `👨‍💼 Vendedor asignado: ${mention(seller)}`
      : '👨‍💼 Vendedor: pendiente de asignar',
    `🆔 Lead: ${lead.id}`
  ].join('\n')

  await sendInteractive(
    ctx.sock,
    ctx.chat,
    {
      title: 'Nero Sales',
      body: message,
      footer: 'Gestión comercial del grupo',
      mentions,
      buttons: [
        quickReply('📞 Atender', `${PREFIX()}leadclaim ${lead.id}`),
        quickReply('🤝 Negociando', `${PREFIX()}leadstatus ${lead.id} negotiating`),
        quickReply('💳 Esperando pago', `${PREFIX()}leadstatus ${lead.id} payment`)
      ]
    },
    ctx.msg
  )

  if (
    seller &&
    ['private', 'both'].includes(state.config.notifyMode)
  ) {
    await ctx.sock.sendMessage(seller, {
      text: [
        '🛒 *Nuevo cliente en un grupo de ventas*',
        `Cliente: ${mention(ctx.sender)}`,
        `Producto: ${product.name}`,
        `Lead: ${lead.id}`,
        `Grupo: ${ctx.chat}`
      ].join('\n'),
      mentions: [ctx.sender]
    }).catch(() => {})
  }
}

async function createInterest(ctx, productId, intent) {
  assertGroup(ctx)

  const state = getSalesGroup(ctx.chat)
  ensureEnabled(state)

  const product = getProduct(state, productId)
  if (!product || product.active === false) {
    throw new Error('Producto no encontrado.')
  }

  const result = withSalesGroup(ctx.chat, group => {
    ensureEnabled(group)
    const currentProduct = getProduct(group, product.id)
    const buyer = jidKey(ctx.sender)

    customerOf(group, buyer)

    const recent = Object.values(group.leads).find(lead =>
      lead.customer === buyer &&
      lead.productId === currentProduct.id &&
      !['paid', 'lost'].includes(lead.status) &&
      now() - Number(lead.createdAt || 0) < 5 * 60 * 1000
    )

    if (recent) {
      recent.lastInterestAt = now()
      return { lead: recent, duplicate: true }
    }

    const id = nextSalesId(group, 'lead')
    const assignedTo = chooseSeller(group, currentProduct)
    const lead = {
      id,
      customer: buyer,
      productId: currentProduct.id,
      intent,
      heat: intent === 'buy' ? 5 : 3,
      status: 'interested',
      assignedTo,
      createdAt: now(),
      updatedAt: now(),
      lastInterestAt: now(),
      notes: []
    }

    group.leads[id] = lead
    return { lead, duplicate: false }
  })

  await notifyLead(ctx, result.lead, product, result.duplicate)
}

async function configHandler(ctx, field) {
  await managerOnly(ctx)

  const raw = ctx.args.join(' ').trim()

  if (field === 'enabled') {
    const value = lower(ctx.args[0])
    if (!['on', 'off'].includes(value)) {
      throw new Error(`Uso: ${PREFIX()}sales on|off`)
    }

    withSalesGroup(ctx.chat, state => {
      state.config.enabled = value === 'on'
    })

    await reply(ctx, `✅ Ventas ${value === 'on' ? 'activado' : 'desactivado'}.`)
    return
  }

  if (!raw) throw new Error('Debes indicar un valor.')

  withSalesGroup(ctx.chat, state => {
    if (field === 'currency') {
      state.config.currency = raw.toUpperCase().slice(0, 8)
    } else {
      state.config[field] = raw.slice(0, field === 'description' ? 500 : 160)
    }
  })

  await reply(ctx, '✅ Configuración de Ventas actualizada.')
}

async function storeHandler(ctx) {
  assertGroup(ctx)
  const state = getSalesGroup(ctx.chat)

  const lines = [
    `🏪 *${state.config.businessName}*`,
    state.config.description || 'Sin descripción.',
    '',
    `💵 Moneda: ${state.config.currency}`,
    state.config.address ? `📍 ${state.config.address}` : null,
    state.config.phone ? `📞 ${state.config.phone}` : null,
    state.config.hours ? `🕐 ${state.config.hours}` : null,
    '',
    `📦 Productos: ${activeProducts(state).length}`,
    `👨‍💼 Vendedores: ${state.sellers.length}`,
    `🔥 Leads abiertos: ${
      Object.values(state.leads)
        .filter(lead => !['paid', 'lost'].includes(lead.status))
        .length
    }`
  ].filter(Boolean)

  await reply(ctx, lines.join('\n'))
}

async function sellerAddHandler(ctx, remove = false) {
  await managerOnly(ctx)
  const target = targetJid(ctx)

  if (!target) {
    throw new Error(
      `Menciona al vendedor. Uso: ${PREFIX()}${remove ? 'delvendedor' : 'addvendedor'} @usuario`
    )
  }

  withSalesGroup(ctx.chat, state => {
    const key = jidKey(target)

    if (remove) {
      state.sellers = state.sellers.filter(jid => jidKey(jid) !== key)
      for (const product of Object.values(state.products)) {
        if (jidKey(product.seller) === key) product.seller = null
      }
    } else if (!state.sellers.some(jid => jidKey(jid) === key)) {
      state.sellers.push(key)
    }
  })

  await reply(
    ctx,
    `${remove ? '🗑️ Vendedor retirado' : '✅ Vendedor añadido'}: ${mention(target)}`,
    { mentions: [target] }
  )
}

async function sellersHandler(ctx) {
  assertGroup(ctx)
  const state = getSalesGroup(ctx.chat)

  await reply(
    ctx,
    [
      '👨‍💼 *Vendedores*',
      '',
      ...(state.sellers.length
        ? state.sellers.map((jid, i) => `${i + 1}. ${mention(jid)}`)
        : ['No hay vendedores registrados.'])
    ].join('\n'),
    { mentions: state.sellers }
  )
}

async function assignModeHandler(ctx) {
  await managerOnly(ctx)
  const value = lower(ctx.args[0])

  if (!['manual', 'roundrobin', 'random'].includes(value)) {
    throw new Error(
      `Uso: ${PREFIX()}salesassign manual|roundrobin|random`
    )
  }

  withSalesGroup(ctx.chat, state => {
    state.config.assignMode = value
  })

  await reply(ctx, `✅ Asignación de leads: ${value}.`)
}

async function notifyModeHandler(ctx) {
  await managerOnly(ctx)
  const value = lower(ctx.args[0])

  if (!['group', 'private', 'both'].includes(value)) {
    throw new Error(
      `Uso: ${PREFIX()}salesnotify group|private|both`
    )
  }

  withSalesGroup(ctx.chat, state => {
    state.config.notifyMode = value
  })

  await reply(ctx, `✅ Notificaciones de ventas: ${value}.`)
}

async function productAddHandler(ctx) {
  await sellerOnly(ctx)
  const [name, priceRaw, stockRaw, category, ...descriptionParts] =
    splitPipe(ctx.args.join(' '))

  const description = descriptionParts.join(' | ')
  const price = Number(priceRaw)
  const stock = stockRaw === '' ? -1 : Number(stockRaw)

  if (!name || !Number.isFinite(price) || price < 0) {
    throw new Error(
      `Uso: ${PREFIX()}productadd Nombre | precio | stock | categoría | descripción`
    )
  }

  const product = withSalesGroup(ctx.chat, state => {
    const id = nextSalesId(state, 'product')
    const value = {
      id,
      name: name.slice(0, 120),
      description: description.slice(0, 1000),
      category: (category || 'General').slice(0, 80),
      price,
      offerPrice: null,
      stock: Number.isFinite(stock) ? Math.floor(stock) : -1,
      imagePath: null,
      videoPath: null,
      seller: null,
      active: true,
      createdBy: jidKey(ctx.sender),
      createdAt: now(),
      updatedAt: now()
    }

    state.products[id] = value
    return value
  })

  await reply(
    ctx,
    `✅ Producto creado: *${product.name}*\n🆔 ${product.id}\n\nAñade imagen respondiendo a una foto con:\n${PREFIX()}productimage ${product.id}`
  )
}

async function productEditHandler(ctx) {
  await sellerOnly(ctx)
  const id = String(ctx.args[0] || '').toUpperCase()
  const rest = ctx.args.slice(1).join(' ')
  const [fieldRaw, ...valueParts] = splitPipe(rest)
  const value = valueParts.join(' | ')
  const field = lower(fieldRaw)

  const aliases = {
    nombre: 'name',
    name: 'name',
    descripcion: 'description',
    descripción: 'description',
    description: 'description',
    categoria: 'category',
    categoría: 'category',
    category: 'category',
    precio: 'price',
    price: 'price',
    oferta: 'offerPrice',
    offer: 'offerPrice',
    stock: 'stock',
    activo: 'active',
    active: 'active'
  }

  const key = aliases[field]

  if (!id || !key || !value) {
    throw new Error(
      `Uso: ${PREFIX()}productedit P-0001 campo | valor`
    )
  }

  withSalesGroup(ctx.chat, state => {
    const product = state.products[id]
    if (!product) throw new Error('Producto no encontrado.')

    if (['price', 'offerPrice'].includes(key)) {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0) throw new Error('Precio inválido.')
      product[key] = key === 'offerPrice' && n === 0 ? null : n
    } else if (key === 'stock') {
      const n = Number(value)
      if (!Number.isFinite(n)) throw new Error('Stock inválido.')
      product.stock = Math.floor(n)
    } else if (key === 'active') {
      product.active = ['true', 'on', 'si', 'sí', '1'].includes(lower(value))
    } else {
      product[key] = value.slice(0, key === 'description' ? 1000 : 120)
    }

    product.updatedAt = now()
  })

  await reply(ctx, `✅ ${id} actualizado.`)
}

async function productDeleteHandler(ctx) {
  await managerOnly(ctx)
  const id = String(ctx.args[0] || '').toUpperCase()

  if (!id) throw new Error(`Uso: ${PREFIX()}productdel P-0001`)

  withSalesGroup(ctx.chat, state => {
    if (!state.products[id]) throw new Error('Producto no encontrado.')
    state.products[id].active = false
    state.products[id].deletedAt = now()
  })

  await reply(ctx, `🗑️ ${id} retirado del catálogo.`)
}

async function productHandler(ctx) {
  assertGroup(ctx)
  const state = getSalesGroup(ctx.chat)
  ensureEnabled(state)

  const query = ctx.args.join(' ').trim()

  if (!query) {
    throw new Error(`Uso: ${PREFIX()}producto <id|nombre>`)
  }

  const product = getProduct(state, query)

  if (!product || product.active === false) {
    throw new Error('Producto no encontrado.')
  }

  await sendProductCard(ctx, product)
}

async function productsHandler(ctx) {
  assertGroup(ctx)
  const state = getSalesGroup(ctx.chat)
  const rows = activeProducts(state)

  await reply(
    ctx,
    [
      `📦 *Productos de ${state.config.businessName}*`,
      '',
      ...(rows.length
        ? rows.slice(0, 50).map(product =>
            `• *${product.id}* — ${product.name} — ${money(productPrice(product), state.config.currency)} — stock ${product.stock < 0 ? '∞' : product.stock}`
          )
        : ['No hay productos activos.'])
    ].join('\n')
  )
}

async function catalogHandler(ctx) {
  assertGroup(ctx)
  const state = getSalesGroup(ctx.chat)
  ensureEnabled(state)

  const category = lower(ctx.args.join(' '))
  let rows = activeProducts(state)

  if (category) {
    rows = rows.filter(product =>
      lower(product.category).includes(category)
    )
  }

  if (!rows.length) {
    throw new Error('No hay productos para esa categoría.')
  }

  const sections = []
  const grouped = new Map()

  for (const product of rows.slice(0, 200)) {
    const cat = product.category || 'General'
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat).push({
      title: product.name.slice(0, 60),
      description:
        `${money(productPrice(product), state.config.currency)} • Stock ${
          product.stock < 0 ? '∞' : product.stock
        } • ${product.id}`,
      id: `${PREFIX()}producto ${product.id}`
    })
  }

  for (const [title, items] of grouped) {
    sections.push({
      title: title.slice(0, 60),
      rows: items.slice(0, 50)
    })
  }

  await sendInteractive(
    ctx.sock,
    ctx.chat,
    {
      title: `🛍️ ${state.config.businessName}`,
      body: state.config.description || 'Selecciona un producto para ver sus detalles.',
      footer: 'Nero Sales',
      buttons: [
        singleSelect('Ver catálogo', sections.slice(0, 10))
      ]
    },
    ctx.msg
  )
}

async function categoriesHandler(ctx) {
  assertGroup(ctx)
  const state = getSalesGroup(ctx.chat)
  const categories = [...new Set(
    activeProducts(state).map(product => product.category || 'General')
  )]

  await reply(
    ctx,
    [
      '🏷️ *Categorías*',
      '',
      ...(categories.length ? categories.map(x => `• ${x}`) : ['Sin categorías.'])
    ].join('\n')
  )
}

async function mediaHandler(ctx, type) {
  await sellerOnly(ctx)
  const id = String(ctx.args[0] || '').toUpperCase()

  if (!id) {
    throw new Error(
      `Uso: ${PREFIX()}${type === 'image' ? 'productimage' : 'productvideo'} P-0001 respondiendo al archivo`
    )
  }

  const state = getSalesGroup(ctx.chat)
  if (!state.products[id]) throw new Error('Producto no encontrado.')

  const buffer = await mediaBuffer(ctx, type)
  const limit = type === 'image' ? 8 * 1024 * 1024 : 40 * 1024 * 1024

  if (buffer.length > limit) {
    throw new Error(
      `${type === 'image' ? 'Imagen' : 'Video'} demasiado grande.`
    )
  }

  const ext = type === 'image' ? 'jpg' : 'mp4'
  const file = path.join(
    salesMediaDir(ctx.chat, id),
    `${type}.${ext}`
  )

  fs.writeFileSync(file, buffer)

  withSalesGroup(ctx.chat, group => {
    group.products[id][type === 'image' ? 'imagePath' : 'videoPath'] = file
    group.products[id].updatedAt = now()
  })

  await reply(
    ctx,
    `✅ ${type === 'image' ? 'Imagen' : 'Video'} guardado para ${id}.`
  )
}

async function demoHandler(ctx) {
  assertGroup(ctx)
  const state = getSalesGroup(ctx.chat)
  const product = getProduct(state, ctx.args.join(' '))

  if (!product) throw new Error('Producto no encontrado.')
  if (!product.videoPath) throw new Error('Este producto no tiene video.')

  const video = fs.readFileSync(product.videoPath)

  await ctx.sock.sendMessage(
    ctx.chat,
    {
      video,
      caption: `🎥 *Demo — ${product.name}*\n🆔 ${product.id}`
    },
    { quoted: ctx.msg }
  )
}

async function setSellerHandler(ctx) {
  await managerOnly(ctx)
  const id = String(ctx.args[0] || '').toUpperCase()
  const target = targetJid(ctx)

  if (!id || !target) {
    throw new Error(`Uso: ${PREFIX()}setseller P-0001 @vendedor`)
  }

  withSalesGroup(ctx.chat, state => {
    const product = state.products[id]
    if (!product) throw new Error('Producto no encontrado.')

    const key = jidKey(target)
    if (!state.sellers.includes(key)) {
      throw new Error('Ese usuario no está registrado como vendedor.')
    }

    product.seller = key
  })

  await reply(
    ctx,
    `✅ ${id} asignado a ${mention(target)}.`,
    { mentions: [target] }
  )
}

async function priceHandler(ctx) {
  assertGroup(ctx)
  const id = String(ctx.args[0] || '').toUpperCase()
  const value = ctx.args[1]
  const state = getSalesGroup(ctx.chat)
  const product = getProduct(state, id || ctx.args.join(' '))

  if (!product) throw new Error('Producto no encontrado.')

  if (value == null) {
    await reply(
      ctx,
      `💰 *${product.name}*\nPrecio: ${money(productPrice(product), state.config.currency)}${
        product.offerPrice ? `\nNormal: ${money(product.price, state.config.currency)}` : ''
      }`
    )
    return
  }

  await sellerOnly(ctx)
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new Error('Precio inválido.')

  withSalesGroup(ctx.chat, group => {
    group.products[product.id].price = n
    group.products[product.id].offerPrice = null
  })

  await reply(ctx, '✅ Precio actualizado.')
}

async function stockHandler(ctx) {
  assertGroup(ctx)
  const id = String(ctx.args[0] || '').toUpperCase()
  const value = ctx.args[1]
  const state = getSalesGroup(ctx.chat)
  const product = getProduct(state, id || ctx.args.join(' '))

  if (!product) throw new Error('Producto no encontrado.')

  if (value == null) {
    await reply(
      ctx,
      `📦 *${product.name}*\nStock: ${product.stock < 0 ? 'Ilimitado' : product.stock}`
    )
    return
  }

  await sellerOnly(ctx)
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error('Stock inválido.')

  withSalesGroup(ctx.chat, group => {
    group.products[product.id].stock = Math.floor(n)
  })

  await reply(ctx, '✅ Stock actualizado.')
}

async function offerHandler(ctx) {
  await sellerOnly(ctx)
  const id = String(ctx.args[0] || '').toUpperCase()
  const value = Number(ctx.args[1])

  if (!id || !Number.isFinite(value) || value < 0) {
    throw new Error(`Uso: ${PREFIX()}oferta P-0001 <precio|0>`)
  }

  withSalesGroup(ctx.chat, state => {
    const product = state.products[id]
    if (!product) throw new Error('Producto no encontrado.')
    product.offerPrice = value === 0 ? null : value
  })

  await reply(ctx, value === 0 ? '✅ Oferta eliminada.' : '✅ Oferta aplicada.')
}

async function offersHandler(ctx) {
  assertGroup(ctx)
  const state = getSalesGroup(ctx.chat)
  const rows = activeProducts(state).filter(product => product.offerPrice)

  await reply(
    ctx,
    [
      '🏷️ *Ofertas*',
      '',
      ...(rows.length
        ? rows.map(product =>
            `• ${product.id} — *${product.name}* — ${money(product.offerPrice, state.config.currency)}`
          )
        : ['No hay ofertas activas.'])
    ].join('\n')
  )
}

async function leadListHandler(ctx, hotOnly = false) {
  await sellerOnly(ctx)
  const state = getSalesGroup(ctx.chat)
  const filter = lower(ctx.args[0])

  let leads = Object.values(state.leads)

  if (hotOnly) leads = leads.filter(lead => Number(lead.heat || 0) >= 4)
  else if (filter) leads = leads.filter(lead => lead.status === filter)

  leads.sort((a, b) => b.updatedAt - a.updatedAt)

  await reply(
    ctx,
    [
      hotOnly ? '🔥 *Leads calientes*' : '🔥 *Leads*',
      '',
      ...(leads.length
        ? leads.slice(0, 50).map(lead => {
            const product = state.products[lead.productId]
            return `• *${lead.id}* — ${mention(lead.customer)} — ${product?.name || lead.productId} — ${statusLabel(lead.status)}${
              lead.assignedTo ? ` — ${mention(lead.assignedTo)}` : ''
            }`
          })
        : ['No hay leads.'])
    ].join('\n'),
    {
      mentions: leads.flatMap(lead =>
        [lead.customer, lead.assignedTo].filter(Boolean)
      )
    }
  )
}

async function leadHandler(ctx) {
  await sellerOnly(ctx)
  const state = getSalesGroup(ctx.chat)
  const query = String(ctx.args[0] || '').toUpperCase()
  const target = targetJid(ctx)

  const lead =
    state.leads[query] ||
    Object.values(state.leads)
      .filter(item => !target || jidKey(item.customer) === jidKey(target))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]

  if (!lead) throw new Error('Lead no encontrado.')

  const product = state.products[lead.productId]

  await reply(
    ctx,
    [
      `🔥 *LEAD ${lead.id}*`,
      `👤 Cliente: ${mention(lead.customer)}`,
      `📦 Producto: ${product?.name || lead.productId}`,
      `🔥 Interés: ${'🔥'.repeat(Math.max(1, Math.min(5, lead.heat || 1)))}`,
      `📌 Estado: ${statusLabel(lead.status)}`,
      `👨‍💼 Vendedor: ${lead.assignedTo ? mention(lead.assignedTo) : 'sin asignar'}`,
      `🕐 Creado: ${dateLabel(lead.createdAt)}`,
      '',
      `📝 Notas: ${(lead.notes || []).length}`
    ].join('\n'),
    {
      mentions: [lead.customer, lead.assignedTo].filter(Boolean)
    }
  )
}

async function leadClaimHandler(ctx) {
  await sellerOnly(ctx)
  const id = String(ctx.args[0] || '').toUpperCase()

  const lead = withSalesGroup(ctx.chat, state => {
    const value = state.leads[id]
    if (!value) throw new Error('Lead no encontrado.')

    if (
      value.assignedTo &&
      jidKey(value.assignedTo) !== jidKey(ctx.sender) &&
      !ctx.isOwner &&
      !ctx.isSubOwner &&
      !ctx.isStaff
    ) {
      throw new Error(
        `Este lead ya está asignado a ${mention(value.assignedTo)}.`
      )
    }

    value.assignedTo = jidKey(ctx.sender)
    value.status = value.status === 'interested' ? 'contacted' : value.status
    value.updatedAt = now()
    return value
  })

  await reply(
    ctx,
    `📞 ${mention(ctx.sender)} atenderá el lead *${lead.id}*.`,
    { mentions: [ctx.sender] }
  )
}

async function leadStatusHandler(ctx) {
  await sellerOnly(ctx)
  const id = String(ctx.args[0] || '').toUpperCase()
  const status = lower(ctx.args[1])

  const allowed = [
    'new',
    'interested',
    'contacted',
    'negotiating',
    'quoted',
    'payment',
    'paid',
    'lost'
  ]

  if (!id || !allowed.includes(status)) {
    throw new Error(
      `Uso: ${PREFIX()}leadstatus L-00001 ${allowed.join('|')}`
    )
  }

  withSalesGroup(ctx.chat, state => {
    const lead = state.leads[id]
    if (!lead) throw new Error('Lead no encontrado.')
    lead.status = status
    lead.updatedAt = now()
  })

  await reply(ctx, `✅ ${id}: ${statusLabel(status)}.`)
}

async function noteHandler(ctx) {
  await sellerOnly(ctx)
  const id = String(ctx.args[0] || '').toUpperCase()
  const note = ctx.args.slice(1).join(' ').trim()

  if (!id || !note) {
    throw new Error(`Uso: ${PREFIX()}nota L-00001 <texto>`)
  }

  withSalesGroup(ctx.chat, state => {
    const lead = state.leads[id]
    if (!lead) throw new Error('Lead no encontrado.')
    lead.notes ||= []
    lead.notes.unshift({
      by: jidKey(ctx.sender),
      text: note.slice(0, 600),
      at: now()
    })
    lead.notes = lead.notes.slice(0, 30)
    lead.updatedAt = now()
  })

  await reply(ctx, '✅ Nota añadida.')
}

async function orderNewHandler(ctx) {
  await sellerOnly(ctx)
  const target = targetJid(ctx)
  const productId = String(
    ctx.args.find(arg => /^P-\d+$/i.test(arg)) || ''
  ).toUpperCase()
  const qtyRaw = ctx.args.find(arg => /^\d+$/.test(arg))
  const qty = Math.max(1, Number(qtyRaw || 1))

  if (!target || !productId) {
    throw new Error(
      `Uso: ${PREFIX()}ordernew @cliente P-0001 [cantidad]`
    )
  }

  const order = withSalesGroup(ctx.chat, state => {
    const product = state.products[productId]
    if (!product || product.active === false) {
      throw new Error('Producto no encontrado.')
    }

    const id = nextSalesId(state, 'order')
    customerOf(state, target)

    const value = {
      id,
      customer: jidKey(target),
      seller: jidKey(ctx.sender),
      status: 'pending',
      paymentStatus: 'pending',
      items: [{
        productId: product.id,
        name: product.name,
        qty,
        unitPrice: productPrice(product)
      }],
      subtotal: 0,
      discountPercent: 0,
      total: 0,
      payments: [],
      paid: 0,
      nextPaymentAt: null,
      notes: [],
      createdAt: now(),
      updatedAt: now()
    }

    recomputeOrder(value)
    state.orders[id] = value
    return value
  })

  await reply(
    ctx,
    `🛍️ Pedido *${order.id}* creado para ${mention(target)}.\nTotal: ${money(order.total, getSalesGroup(ctx.chat).config.currency)}`,
    { mentions: [target] }
  )
}

async function orderAddHandler(ctx) {
  await sellerOnly(ctx)
  const orderId = String(ctx.args[0] || '').toUpperCase()
  const productId = String(ctx.args[1] || '').toUpperCase()
  const qty = Math.max(1, Number(ctx.args[2] || 1))

  if (!orderId || !productId) {
    throw new Error(
      `Uso: ${PREFIX()}orderadd O-00001 P-0001 [cantidad]`
    )
  }

  const order = withSalesGroup(ctx.chat, state => {
    const value = state.orders[orderId]
    const product = state.products[productId]

    if (!value) throw new Error('Pedido no encontrado.')
    if (!product) throw new Error('Producto no encontrado.')

    const existing = value.items.find(item => item.productId === productId)

    if (existing) existing.qty += qty
    else {
      value.items.push({
        productId,
        name: product.name,
        qty,
        unitPrice: productPrice(product)
      })
    }

    return recomputeOrder(value)
  })

  await reply(
    ctx,
    `✅ Pedido ${order.id} actualizado. Total: ${money(order.total, getSalesGroup(ctx.chat).config.currency)}`
  )
}

async function orderHandler(ctx) {
  await sellerOnly(ctx)
  const id = String(ctx.args[0] || '').toUpperCase()
  const state = getSalesGroup(ctx.chat)
  const order = state.orders[id]

  if (!order) throw new Error('Pedido no encontrado.')

  await reply(
    ctx,
    [
      `🛍️ *PEDIDO ${order.id}*`,
      `👤 Cliente: ${mention(order.customer)}`,
      `👨‍💼 Vendedor: ${mention(order.seller)}`,
      `📌 Estado: ${orderStatusLabel(order.status)}`,
      `💳 Pago: ${order.paymentStatus}`,
      '',
      ...(order.items || []).map(item =>
        `• ${item.qty}x ${item.name} — ${money(item.unitPrice, state.config.currency)}`
      ),
      '',
      `Subtotal: ${money(order.subtotal, state.config.currency)}`,
      order.discountPercent
        ? `Descuento: ${order.discountPercent}%`
        : null,
      `*TOTAL: ${money(order.total, state.config.currency)}*`,
      `Pagado: ${money(order.paid, state.config.currency)}`,
      `Pendiente: ${money(Math.max(0, order.total - order.paid), state.config.currency)}`,
      order.nextPaymentAt
        ? `📅 Próximo pago: ${dateLabel(order.nextPaymentAt)}`
        : null
    ].filter(Boolean).join('\n'),
    { mentions: [order.customer, order.seller] }
  )
}

async function ordersHandler(ctx) {
  await sellerOnly(ctx)
  const state = getSalesGroup(ctx.chat)
  const filter = lower(ctx.args[0])

  let orders = Object.values(state.orders)
  if (filter) {
    orders = orders.filter(order =>
      order.status === filter || order.paymentStatus === filter
    )
  }

  orders.sort((a, b) => b.updatedAt - a.updatedAt)

  await reply(
    ctx,
    [
      '🛍️ *Pedidos*',
      '',
      ...(orders.length
        ? orders.slice(0, 50).map(order =>
            `• *${order.id}* — ${mention(order.customer)} — ${orderStatusLabel(order.status)} — ${money(order.total, state.config.currency)} — ${order.paymentStatus}`
          )
        : ['No hay pedidos.'])
    ].join('\n'),
    {
      mentions: orders.map(order => order.customer)
    }
  )
}

async function orderStatusHandler(ctx) {
  await sellerOnly(ctx)
  const id = String(ctx.args[0] || '').toUpperCase()
  const status = lower(ctx.args[1])
  const allowed = [
    'pending',
    'confirmed',
    'preparing',
    'shipped',
    'delivered',
    'completed',
    'cancelled'
  ]

  if (!id || !allowed.includes(status)) {
    throw new Error(
      `Uso: ${PREFIX()}orderstatus O-00001 ${allowed.join('|')}`
    )
  }

  withSalesGroup(ctx.chat, state => {
    const order = state.orders[id]
    if (!order) throw new Error('Pedido no encontrado.')
    order.status = status
    order.updatedAt = now()
  })

  await reply(ctx, `✅ ${id}: ${orderStatusLabel(status)}.`)
}

async function discountHandler(ctx) {
  await sellerOnly(ctx)
  const id = String(ctx.args[0] || '').toUpperCase()
  const discount = Number(ctx.args[1])

  if (!id || !Number.isFinite(discount) || discount < 0 || discount > 100) {
    throw new Error(`Uso: ${PREFIX()}descuento O-00001 <0-100>`)
  }

  const order = withSalesGroup(ctx.chat, state => {
    const value = state.orders[id]
    if (!value) throw new Error('Pedido no encontrado.')
    value.discountPercent = discount
    return recomputeOrder(value)
  })

  await reply(
    ctx,
    `✅ Descuento aplicado. Total: ${money(order.total, getSalesGroup(ctx.chat).config.currency)}`
  )
}

async function paymentHandler(ctx) {
  await sellerOnly(ctx)
  const orderId = String(ctx.args[0] || '').toUpperCase()
  const rest = ctx.args.slice(1).join(' ')
  const [amountRaw, methodRaw, nextRaw] = splitPipe(rest)
  const amount = Number(amountRaw)

  if (!orderId || !Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      `Uso: ${PREFIX()}pago O-00001 cantidad | método | próxima fecha opcional`
    )
  }

  const nextPaymentAt = nextRaw ? parseDateValue(nextRaw) : null

  if (nextRaw && !nextPaymentAt) {
    throw new Error(
      'Fecha inválida. Usa DD/MM/AAAA, DD/MM/AAAA HH:mm, hoy o mañana.'
    )
  }

  const order = withSalesGroup(ctx.chat, state => {
    const value = state.orders[orderId]
    if (!value) throw new Error('Pedido no encontrado.')

    value.payments ||= []
    value.payments.push({
      id: `PAY-${Date.now().toString(36)}`,
      amount,
      method: methodRaw || 'No especificado',
      by: jidKey(ctx.sender),
      at: now()
    })

    if (nextPaymentAt) value.nextPaymentAt = nextPaymentAt
    recomputeOrder(value)

    if (value.paymentStatus === 'paid') {
      value.nextPaymentAt = null
      const lead = Object.values(state.leads)
        .filter(item =>
          item.customer === value.customer &&
          value.items.some(product => product.productId === item.productId)
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)[0]
      if (lead) {
        lead.status = 'paid'
        lead.updatedAt = now()
      }
    }

    return value
  })

  const state = getSalesGroup(ctx.chat)

  await reply(
    ctx,
    [
      '💳 *PAGO REGISTRADO*',
      `Pedido: ${order.id}`,
      `Total: ${money(order.total, state.config.currency)}`,
      `Pagado: ${money(order.paid, state.config.currency)}`,
      `Pendiente: ${money(Math.max(0, order.total - order.paid), state.config.currency)}`,
      `Estado: ${order.paymentStatus}`,
      order.nextPaymentAt
        ? `Próximo pago: ${dateLabel(order.nextPaymentAt)}`
        : null
    ].filter(Boolean).join('\n')
  )
}

async function nextPaymentHandler(ctx) {
  await sellerOnly(ctx)
  const orderId = String(ctx.args[0] || '').toUpperCase()
  const raw = ctx.args.slice(1).join(' ')
  const date = parseDateValue(raw)

  if (!orderId || !date) {
    throw new Error(
      `Uso: ${PREFIX()}fechapago O-00001 DD/MM/AAAA [HH:mm]`
    )
  }

  withSalesGroup(ctx.chat, state => {
    const order = state.orders[orderId]
    if (!order) throw new Error('Pedido no encontrado.')
    order.nextPaymentAt = date
    order.updatedAt = now()
  })

  await reply(ctx, `📅 Próximo pago de ${orderId}: ${dateLabel(date)}.`)
}

function dateWindow(mode) {
  const current = new Date()
  const startToday = new Date(
    current.getFullYear(),
    current.getMonth(),
    current.getDate()
  ).getTime()

  if (mode === 'today' || mode === 'hoy') {
    return [startToday, startToday + 86400000]
  }

  if (mode === 'tomorrow' || mode === 'mañana' || mode === 'manana') {
    return [startToday + 86400000, startToday + 2 * 86400000]
  }

  if (mode === 'week' || mode === 'semana') {
    return [startToday, startToday + 7 * 86400000]
  }

  if (mode === 'overdue' || mode === 'atrasados') {
    return [0, now()]
  }

  return [0, Number.MAX_SAFE_INTEGER]
}

async function chargesHandler(ctx) {
  await sellerOnly(ctx)
  const state = getSalesGroup(ctx.chat)
  const mode = lower(ctx.args[0] || '')
  const [from, to] = dateWindow(mode)

  const rows = Object.values(state.orders)
    .filter(order =>
      order.paymentStatus !== 'paid' &&
      order.nextPaymentAt &&
      order.nextPaymentAt >= from &&
      order.nextPaymentAt < to
    )
    .sort((a, b) => a.nextPaymentAt - b.nextPaymentAt)

  await reply(
    ctx,
    [
      '💳 *Cobros pendientes*',
      '',
      ...(rows.length
        ? rows.map(order =>
            `• ${order.id} — ${mention(order.customer)} — ${money(Math.max(0, order.total - order.paid), state.config.currency)} — ${dateLabel(order.nextPaymentAt)}`
          )
        : ['No hay cobros para ese filtro.'])
    ].join('\n'),
    {
      mentions: rows.map(order => order.customer)
    }
  )
}

async function followupAddHandler(ctx) {
  await sellerOnly(ctx)
  const target = targetJid(ctx)
  const leadId = String(
    ctx.args.find(arg => /^L-\d+$/i.test(arg)) || ''
  ).toUpperCase()
  const raw = ctx.args
    .filter(arg => !/^L-\d+$/i.test(arg) && !String(arg).startsWith('@'))
    .join(' ')
  const [dateRaw, ...noteParts] = splitPipe(raw)
  const date = parseDateValue(dateRaw)
  const note = noteParts.join(' | ')

  const state = getSalesGroup(ctx.chat)
  const lead = leadId ? state.leads[leadId] : null
  const customer = target || lead?.customer

  if (!customer || !date) {
    throw new Error(
      `Uso: ${PREFIX()}seguimiento @cliente DD/MM/AAAA HH:mm | nota\nO: ${PREFIX()}seguimiento L-00001 mañana 15:00 | nota`
    )
  }

  const followup = withSalesGroup(ctx.chat, group => {
    const id = nextSalesId(group, 'followup')
    const value = {
      id,
      customer: jidKey(customer),
      leadId: lead?.id || null,
      seller: jidKey(ctx.sender),
      dueAt: date,
      note: note.slice(0, 600),
      status: 'pending',
      createdAt: now(),
      completedAt: null
    }

    group.followups[id] = value
    customerOf(group, customer)
    return value
  })

  await reply(
    ctx,
    `📅 Seguimiento ${followup.id} guardado para ${mention(customer)}\n🕐 ${dateLabel(date)}\n📝 ${followup.note || 'Sin nota'}`,
    { mentions: [customer] }
  )
}

async function followupsHandler(ctx) {
  await sellerOnly(ctx)
  const state = getSalesGroup(ctx.chat)
  const mode = lower(ctx.args[0] || '')
  const [from, to] = dateWindow(mode)

  const rows = Object.values(state.followups)
    .filter(item =>
      item.status === 'pending' &&
      item.dueAt >= from &&
      item.dueAt < to
    )
    .sort((a, b) => a.dueAt - b.dueAt)

  await reply(
    ctx,
    [
      '📅 *Seguimientos*',
      '',
      ...(rows.length
        ? rows.slice(0, 50).map(item =>
            `• *${item.id}* — ${mention(item.customer)} — ${dateLabel(item.dueAt)} — ${item.note || 'sin nota'}`
          )
        : ['No hay seguimientos para ese filtro.'])
    ].join('\n'),
    {
      mentions: rows.map(item => item.customer)
    }
  )
}

async function followupDoneHandler(ctx) {
  await sellerOnly(ctx)
  const id = String(ctx.args[0] || '').toUpperCase()

  if (!id) throw new Error(`Uso: ${PREFIX()}seguimientodone F-00001`)

  withSalesGroup(ctx.chat, state => {
    const item = state.followups[id]
    if (!item) throw new Error('Seguimiento no encontrado.')
    item.status = 'done'
    item.completedAt = now()
  })

  await reply(ctx, `✅ Seguimiento ${id} completado.`)
}

function periodStart(mode) {
  const date = new Date()

  if (mode === 'hoy' || mode === 'today') {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    ).getTime()
  }

  if (mode === 'semana' || mode === 'week') {
    return now() - 7 * 86400000
  }

  if (mode === 'año' || mode === 'ano' || mode === 'year') {
    return new Date(date.getFullYear(), 0, 1).getTime()
  }

  return new Date(
    date.getFullYear(),
    date.getMonth(),
    1
  ).getTime()
}

async function statsHandler(ctx) {
  await sellerOnly(ctx)
  const state = getSalesGroup(ctx.chat)
  const mode = lower(ctx.args[0] || 'mes')
  const start = periodStart(mode)

  const orders = Object.values(state.orders)
    .filter(order => order.createdAt >= start)

  const sold = orders.reduce((sum, order) => sum + order.total, 0)
  const collected = orders.reduce((sum, order) => sum + order.paid, 0)
  const pending = orders.reduce(
    (sum, order) => sum + Math.max(0, order.total - order.paid),
    0
  )

  const leads = Object.values(state.leads)
    .filter(lead => lead.createdAt >= start)
  const won = leads.filter(lead => lead.status === 'paid').length
  const conversion = leads.length ? won / leads.length * 100 : 0

  const productUnits = new Map()

  for (const order of orders) {
    for (const item of order.items || []) {
      productUnits.set(
        item.productId,
        (productUnits.get(item.productId) || 0) + Number(item.qty || 0)
      )
    }
  }

  const top = [...productUnits.entries()]
    .sort((a, b) => b[1] - a[1])[0]
  const topProduct = top ? state.products[top[0]] : null

  await reply(
    ctx,
    [
      `📊 *VENTAS — ${mode.toUpperCase()}*`,
      '',
      `💰 Vendido: ${money(sold, state.config.currency)}`,
      `💳 Cobrado: ${money(collected, state.config.currency)}`,
      `⏳ Pendiente: ${money(pending, state.config.currency)}`,
      '',
      `🛍️ Pedidos: ${orders.length}`,
      `🔥 Leads: ${leads.length}`,
      `✅ Convertidos: ${won}`,
      `📈 Conversión: ${conversion.toFixed(1)}%`,
      '',
      topProduct
        ? `🏆 Producto: ${topProduct.name} (${top[1]} unidades)`
        : '🏆 Producto: sin datos'
    ].join('\n')
  )
}

async function topProductHandler(ctx) {
  await sellerOnly(ctx)
  const state = getSalesGroup(ctx.chat)
  const counts = new Map()

  for (const order of Object.values(state.orders)) {
    for (const item of order.items || []) {
      counts.set(
        item.productId,
        (counts.get(item.productId) || 0) + Number(item.qty || 0)
      )
    }
  }

  const rows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  await reply(
    ctx,
    [
      '🏆 *Productos más vendidos*',
      '',
      ...(rows.length
        ? rows.map(([id, qty], index) =>
            `${index + 1}. ${state.products[id]?.name || id} — ${qty}`
          )
        : ['Sin datos.'])
    ].join('\n')
  )
}

async function topSellerHandler(ctx) {
  await sellerOnly(ctx)
  const state = getSalesGroup(ctx.chat)
  const totals = new Map()

  for (const order of Object.values(state.orders)) {
    if (order.status === 'cancelled') continue
    totals.set(
      order.seller,
      (totals.get(order.seller) || 0) + Number(order.total || 0)
    )
  }

  const rows = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)

  await reply(
    ctx,
    [
      '👑 *Vendedores*',
      '',
      ...(rows.length
        ? rows.map(([jid, total], index) =>
            `${index + 1}. ${mention(jid)} — ${money(total, state.config.currency)}`
          )
        : ['Sin datos.'])
    ].join('\n'),
    { mentions: rows.map(([jid]) => jid) }
  )
}

async function commercialDocumentHandler(ctx, type) {
  await sellerOnly(ctx)
  const orderId = String(ctx.args[0] || '').toUpperCase()
  const state = getSalesGroup(ctx.chat)
  const order = state.orders[orderId]

  if (!order) throw new Error('Pedido no encontrado.')

  const customer = state.customers[order.customer] || {
    jid: order.customer,
    label: mention(order.customer)
  }

  const buffer = await createCommercialDocument({
    type,
    business: state.config,
    order,
    customer
  })

  const label = {
    quote: 'cotizacion',
    receipt: 'comprobante',
    invoice: 'factura-interna'
  }[type]

  await ctx.sock.sendMessage(
    ctx.chat,
    {
      document: buffer,
      mimetype: 'application/pdf',
      fileName: `${label}-${order.id}.pdf`,
      caption: type === 'invoice'
        ? `🧾 ${order.id} — Documento interno, no fiscal.`
        : `🧾 ${order.id} — ${label}.`
    },
    { quoted: ctx.msg }
  )
}

function csvEscape(value) {
  const text = String(value ?? '')
  if (!/[",\n]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}

async function exportHandler(ctx, type) {
  await sellerOnly(ctx)
  const state = getSalesGroup(ctx.chat)
  let rows
  let headers

  if (type === 'products') {
    headers = ['id', 'name', 'category', 'price', 'offerPrice', 'stock', 'active']
    rows = Object.values(state.products).map(product => [
      product.id,
      product.name,
      product.category,
      product.price,
      product.offerPrice || '',
      product.stock,
      product.active !== false
    ])
  } else {
    headers = [
      'id', 'customer', 'seller', 'status', 'paymentStatus',
      'subtotal', 'discountPercent', 'total', 'paid',
      'nextPaymentAt', 'createdAt'
    ]
    rows = Object.values(state.orders).map(order => [
      order.id,
      order.customer,
      order.seller,
      order.status,
      order.paymentStatus,
      order.subtotal,
      order.discountPercent,
      order.total,
      order.paid,
      order.nextPaymentAt ? new Date(order.nextPaymentAt).toISOString() : '',
      new Date(order.createdAt).toISOString()
    ])
  }

  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(csvEscape).join(','))
  ].join('\n')

  await ctx.sock.sendMessage(
    ctx.chat,
    {
      document: Buffer.from(csv, 'utf8'),
      mimetype: 'text/csv',
      fileName: `nero-sales-${type}-${Date.now()}.csv`
    },
    { quoted: ctx.msg }
  )
}

const SALES_HELP = [
  ['🏪 NEGOCIO', [
    ['.sales on|off', 'Activa o desactiva Ventas en el grupo.'],
    ['.tienda', 'Muestra la ficha del negocio.'],
    ['.settienda <nombre>', 'Cambia el nombre del negocio.'],
    ['.setmoneda <PEN|USD|COP...>', 'Define la moneda mostrada.'],
    ['.setdescripcion <texto>', 'Configura la descripción.'],
    ['.setdireccion <texto>', 'Configura dirección.'],
    ['.settelefono <texto>', 'Configura contacto.'],
    ['.sethorario <texto>', 'Configura horario.'],
    ['.salesassign manual|roundrobin|random', 'Define cómo asignar interesados.'],
    ['.salesnotify group|private|both', 'Define dónde se notifican nuevos leads.']
  ]],
  ['👨‍💼 VENDEDORES', [
    ['.addvendedor @usuario', 'Autoriza a un vendedor.'],
    ['.delvendedor @usuario', 'Retira a un vendedor.'],
    ['.vendedores', 'Lista vendedores registrados.'],
    ['.setseller P-0001 @vendedor', 'Asigna un producto a un vendedor.']
  ]],
  ['📦 CATÁLOGO', [
    ['.productadd Nombre | precio | stock | categoría | descripción', 'Crea un producto.'],
    ['.productedit P-0001 campo | valor', 'Edita nombre, precio, stock, oferta, categoría, etc.'],
    ['.productdel P-0001', 'Retira un producto del catálogo.'],
    ['.producto P-0001', 'Muestra el producto con botones Comprar/Interés.'],
    ['.productos', 'Lista los productos del grupo.'],
    ['.catalogo [categoría]', 'Abre el catálogo interactivo.'],
    ['.categorias', 'Lista las categorías.'],
    ['.productimage P-0001', 'Guarda una imagen respondiendo a una foto.'],
    ['.productvideo P-0001', 'Guarda una demo respondiendo a un video.'],
    ['.demo P-0001', 'Envía el video de demostración.'],
    ['.precio P-0001 [nuevo precio]', 'Consulta o cambia el precio.'],
    ['.stock P-0001 [cantidad]', 'Consulta o cambia el stock.'],
    ['.oferta P-0001 <precio|0>', 'Aplica o elimina precio de oferta.'],
    ['.ofertas', 'Muestra ofertas activas.']
  ]],
  ['🔥 INTERESADOS / LEADS', [
    ['Botón 🛒 Comprar', 'Registra intención alta y avisa al vendedor.'],
    ['Botón ❤️ Me interesa', 'Registra un lead interesado.'],
    ['.leads [estado]', 'Lista leads del grupo.'],
    ['.hotleads', 'Muestra leads con interés alto.'],
    ['.lead L-00001', 'Muestra la ficha de un lead.'],
    ['.leadclaim L-00001', 'Toma un lead para atenderlo.'],
    ['.leadstatus L-00001 <estado>', 'Cambia el estado comercial.'],
    ['.nota L-00001 <texto>', 'Añade notas privadas de gestión.']
  ]],
  ['🛍️ PEDIDOS', [
    ['.ordernew @cliente P-0001 [cantidad]', 'Crea un pedido.'],
    ['.orderadd O-00001 P-0002 [cantidad]', 'Añade productos al pedido.'],
    ['.pedido O-00001', 'Muestra un pedido.'],
    ['.pedidos [estado]', 'Lista pedidos.'],
    ['.orderstatus O-00001 <estado>', 'Actualiza preparación/entrega/cancelación.'],
    ['.descuento O-00001 <0-100>', 'Aplica descuento porcentual.']
  ]],
  ['💳 PAGOS Y COBROS', [
    ['.pago O-00001 cantidad | método | próxima fecha', 'Registra un pago total o parcial.'],
    ['.fechapago O-00001 <fecha>', 'Programa la próxima fecha de cobro.'],
    ['.cobros [hoy|mañana|semana|atrasados]', 'Muestra pagos pendientes por fecha.']
  ]],
  ['📅 SEGUIMIENTOS', [
    ['.seguimiento @cliente <fecha> | nota', 'Programa un contacto comercial.'],
    ['.seguimiento L-00001 <fecha> | nota', 'Programa seguimiento de un lead.'],
    ['.seguimientos [hoy|mañana|semana|atrasados]', 'Lista seguimientos pendientes.'],
    ['.seguimientodone F-00001', 'Marca un seguimiento como completado.']
  ]],
  ['🧾 DOCUMENTOS', [
    ['.cotizacion O-00001', 'Genera una cotización/proforma PDF.'],
    ['.comprobante O-00001', 'Genera un comprobante comercial PDF.'],
    ['.factura O-00001', 'Genera una factura interna PDF NO fiscal.']
  ]],
  ['📊 ESTADÍSTICAS', [
    ['.ventas [hoy|semana|mes|año]', 'Resumen de ventas, cobros, leads y conversión.'],
    ['.salesstats', 'Alias del panel de ventas.'],
    ['.productotop', 'Ranking de productos vendidos.'],
    ['.vendedortop', 'Ranking de vendedores por valor de pedidos.'],
    ['.exportproductos', 'Exporta el catálogo a CSV.'],
    ['.exportventas', 'Exporta pedidos/ventas a CSV.']
  ]]
]

async function salesInfoHandler(ctx) {
  assertGroup(ctx)

  const lines = [
    '💼 *NERO SALES — ADMINISTRACIÓN DE TU NEGOCIO*',
    '',
    'Cada grupo tiene su propia tienda y sus datos están separados de otros grupos.',
    ''
  ]

  for (const [title, entries] of SALES_HELP) {
    lines.push(`*${title}*`, '')
    for (const [usage, description] of entries) {
      lines.push(`✦ *${usage}*`)
      lines.push(`└ ${description}`)
      lines.push('')
    }
  }

  await reply(ctx, lines.join('\n'))
}

function command(name, execute, aliases = []) {
  return {
    name,
    aliases,
    async execute(ctx) {
      try {
        await execute(ctx)
      } catch (error) {
        console.error(`[SALES:${name}]`, error)
        await reply(
          ctx,
          `❌ ${error?.message || error}`
        ).catch(() => {})
      }
    }
  }
}

export const salesCommands = [
  command('salesinfo', salesInfoHandler, ['ventasinfo']),
  command('sales', ctx => configHandler(ctx, 'enabled')),
  command('tienda', storeHandler),
  command('settienda', ctx => configHandler(ctx, 'businessName')),
  command('setmoneda', ctx => configHandler(ctx, 'currency')),
  command('setdescripcion', ctx => configHandler(ctx, 'description')),
  command('setdireccion', ctx => configHandler(ctx, 'address')),
  command('settelefono', ctx => configHandler(ctx, 'phone')),
  command('sethorario', ctx => configHandler(ctx, 'hours')),
  command('salesassign', assignModeHandler),
  command('salesnotify', notifyModeHandler),

  command('addvendedor', ctx => sellerAddHandler(ctx, false)),
  command('delvendedor', ctx => sellerAddHandler(ctx, true)),
  command('vendedores', sellersHandler),
  command('setseller', setSellerHandler),

  command('productadd', productAddHandler, ['addproduct']),
  command('productedit', productEditHandler, ['editproduct']),
  command('productdel', productDeleteHandler, ['delproduct']),
  command('producto', productHandler, ['product']),
  command('productos', productsHandler, ['products']),
  command('catalogo', catalogHandler, ['catalog']),
  command('categorias', categoriesHandler),
  command('productimage', ctx => mediaHandler(ctx, 'image')),
  command('productvideo', ctx => mediaHandler(ctx, 'video')),
  command('demo', demoHandler),
  command('precio', priceHandler),
  command('stock', stockHandler),
  command('oferta', offerHandler),
  command('ofertas', offersHandler),

  command('salesbuy', ctx => createInterest(ctx, ctx.args[0], 'buy')),
  command('salesinterest', ctx => createInterest(ctx, ctx.args[0], 'interest')),
  command('leads', ctx => leadListHandler(ctx, false)),
  command('hotleads', ctx => leadListHandler(ctx, true)),
  command('lead', leadHandler),
  command('leadclaim', leadClaimHandler),
  command('leadstatus', leadStatusHandler),
  command('nota', noteHandler),

  command('ordernew', orderNewHandler),
  command('orderadd', orderAddHandler),
  command('pedido', orderHandler, ['order']),
  command('pedidos', ordersHandler, ['orders']),
  command('orderstatus', orderStatusHandler),
  command('descuento', discountHandler),

  command('pago', paymentHandler),
  command('fechapago', nextPaymentHandler),
  command('cobros', chargesHandler),

  command('seguimiento', followupAddHandler),
  command('seguimientos', followupsHandler),
  command('seguimientodone', followupDoneHandler),

  command('cotizacion', ctx => commercialDocumentHandler(ctx, 'quote')),
  command('comprobante', ctx => commercialDocumentHandler(ctx, 'receipt')),
  command('factura', ctx => commercialDocumentHandler(ctx, 'invoice')),

  command('ventas', statsHandler, ['salesstats']),
  command('productotop', topProductHandler),
  command('vendedortop', topSellerHandler),
  command('exportproductos', ctx => exportHandler(ctx, 'products')),
  command('exportventas', ctx => exportHandler(ctx, 'orders'))
]
