import PDFDocument from 'pdfkit'

function money(value, currency = 'PEN') {
  return `${currency} ${Number(value || 0).toFixed(2)}`
}

function renderBuffer(build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: {
        Title: 'Nero Sales',
        Author: 'Nero Bot'
      }
    })

    const chunks = []
    doc.on('data', chunk => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    build(doc)
    doc.end()
  })
}

function itemTotal(item) {
  return Number(item.unitPrice || 0) * Number(item.qty || 0)
}

export async function createCommercialDocument({
  type = 'quote',
  business,
  order,
  customer
}) {
  const currency = business?.currency || 'PEN'
  const labels = {
    quote: 'COTIZACIÓN / PROFORMA',
    receipt: 'COMPROBANTE DE PAGO',
    invoice: 'FACTURA INTERNA - NO FISCAL'
  }

  return renderBuffer(doc => {
    doc
      .fontSize(20)
      .text(business?.businessName || 'Negocio', { align: 'center' })

    doc
      .moveDown(0.3)
      .fontSize(14)
      .text(labels[type] || labels.quote, { align: 'center' })

    doc.moveDown()
    doc.fontSize(10)

    if (business?.description) doc.text(business.description)
    if (business?.address) doc.text(`Dirección: ${business.address}`)
    if (business?.phone) doc.text(`Contacto: ${business.phone}`)

    doc.moveDown()
    doc.text(`Documento: ${order.id}`)
    doc.text(`Fecha: ${new Date().toLocaleString('es-PE')}`)
    doc.text(`Cliente: ${customer?.label || customer?.jid || 'No registrado'}`)
    doc.text(`Estado del pedido: ${order.status}`)

    doc.moveDown()
    doc.fontSize(11).text('Detalle', { underline: true })
    doc.moveDown(0.3)

    for (const item of order.items || []) {
      doc
        .fontSize(10)
        .text(
          `${item.qty} x ${item.name} - ${money(item.unitPrice, currency)} = ${money(itemTotal(item), currency)}`
        )
    }

    doc.moveDown()
    doc.text(`Subtotal: ${money(order.subtotal, currency)}`)

    if (Number(order.discountPercent || 0) > 0) {
      doc.text(`Descuento: ${Number(order.discountPercent).toFixed(2)}%`)
    }

    doc.fontSize(12).text(`TOTAL: ${money(order.total, currency)}`, {
      align: 'right'
    })

    doc.moveDown()
    doc.fontSize(10)
    doc.text(`Pagado: ${money(order.paid, currency)}`)
    doc.text(`Pendiente: ${money(Math.max(0, order.total - order.paid), currency)}`)

    if (order.nextPaymentAt) {
      doc.text(
        `Próximo pago: ${new Date(order.nextPaymentAt).toLocaleString('es-PE')}`
      )
    }

    doc.moveDown(2)
    doc.fontSize(8).fillColor('#555555')

    if (type === 'invoice') {
      doc.text(
        'Documento interno generado por Nero Bot. No constituye una factura fiscal oficial ni sustituye la facturación exigida por la autoridad tributaria correspondiente.'
      )
    } else {
      doc.text(
        'Documento comercial generado automáticamente por Nero Bot.'
      )
    }
  })
}
