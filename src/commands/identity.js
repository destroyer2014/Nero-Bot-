import { jidNormalizedUser } from '@itsliaaa/baileys'
import { createSubbotForPhone } from './subbots.js'
import { canRequestCode } from '../lib/subbotManager.js'
import { setPendingSubbotPhone } from '../lib/pendingSubbotPhone.js'
import { getCachedPhoneForLid, setCachedPhoneForLid } from '../lib/lidCache.js'

const digits = value => String(value || '')
  .split('@')[0]
  .split(':')[0]
  .replace(/\D/g, '')

const isPhoneJid = value => String(value || '').endsWith('@s.whatsapp.net')
const isLid = value => String(value || '').endsWith('@lid')

function candidates(ctx) {
  const key = ctx.msg?.key || {}
  return [
    key.participantAlt,
    key.remoteJidAlt,
    key.participant,
    key.remoteJid,
    ctx.sender
  ].filter(Boolean)
}

async function phoneFromLid(ctx, lid) {
  const lidDigits = digits(lid)
  const cached = getCachedPhoneForLid(lidDigits)
  if (cached) return cached

  try {
    const mapped = await ctx.sock.signalRepository?.lidMapping?.getPNForLID(lid)
    const phone = digits(mapped)
    if (phone.length >= 8 && phone.length <= 15 && phone !== lidDigits) {
      setCachedPhoneForLid(lidDigits, phone)
      return phone
    }
  } catch (error) {
    console.warn('[IDENTITY] lidMapping:', error?.message || error)
  }

  if (String(ctx.chat || '').endsWith('@g.us')) {
    try {
      const metadata = await ctx.sock.groupMetadata(ctx.chat)
      const match = (metadata?.participants || []).find(participant => {
        const values = [
          participant?.id,
          participant?.jid,
          participant?.lid,
          participant?.phoneNumber
        ].filter(Boolean)
        return values.some(value =>
          String(value) === String(lid) || digits(value) === lidDigits
        )
      })

      for (const value of [match?.phoneNumber, match?.jid, match?.id]) {
        const phone = digits(value)
        if (
          isPhoneJid(value) &&
          phone.length >= 8 &&
          phone.length <= 15 &&
          phone !== lidDigits
        ) {
          setCachedPhoneForLid(lidDigits, phone)
          return phone
        }
      }
    } catch (error) {
      console.warn('[IDENTITY] metadata:', error?.message || error)
    }
  }

  return null
}

export async function resolveSenderPhone(ctx) {
  const values = candidates(ctx)

  for (const value of values) {
    const phone = digits(value)
    if (isPhoneJid(value) && phone.length >= 8 && phone.length <= 15) {
      return phone
    }
  }

  const lid = values.find(isLid)
  return lid ? phoneFromLid(ctx, jidNormalizedUser(lid)) : null
}

function friendlyError(error) {
  const raw = String(error?.message || 'No se pudo generar el código.')
  if (/rate[-_ ]?overlimit|too many requests|\b429\b/i.test(raw)) {
    return '⏳ WhatsApp aplicó un límite temporal. Espera unos minutos antes de solicitar otro código.'
  }
  return `❌ ${raw}`
}

export const automaticCodeCommand = {
  name: 'code',
  aliases: ['jadibot'],
  async execute(ctx) {
    try {
      if (ctx.args?.[0]) {
        await createSubbotForPhone(ctx, ctx.args[0])
        return
      }

      const phone = await resolveSenderPhone(ctx)
      if (phone) {
        await createSubbotForPhone(ctx, phone)
        return
      }

      const wait = canRequestCode(ctx.sender)
      if (wait > 0) {
        await ctx.sock.sendMessage(ctx.chat, {
          text: `⏳ Debes esperar ${Math.ceil(wait / 1000)} segundos para volver a intentarlo.`
        }, { quoted: ctx.msg })
        return
      }

      setPendingSubbotPhone(ctx.chat, ctx.sender)
      await ctx.sock.sendMessage(ctx.chat, {
        text: '📱 *No pude resolver tu número desde el LID.*\nEscribe ahora tu número real con código de país y solo dígitos.\n\nEjemplo: *51912345678*\nTienes 2 minutos para responder.'
      }, { quoted: ctx.msg })
    } catch (error) {
      console.error('[AUTO .code]', error)
      await ctx.sock.sendMessage(
        ctx.chat,
        { text: friendlyError(error) },
        { quoted: ctx.msg }
      ).catch(() => {})
    }
  }
}

export const idCommand = {
  name: 'id',
  aliases: ['lid', 'myid'],
  async execute(ctx) {
    const values = candidates(ctx)
    const lid = values.find(isLid) || null
    const phone = await resolveSenderPhone(ctx)
    const level = String(ctx.permissionLevel || 'user')
    const role = level === 'owner'
      ? '👑 Owner'
      : level === 'subowner'
        ? '🛡️ SubOwner (acceso total)'
        : '👤 Usuario'

    const lines = [
      '🪪 *Tu identidad en Nero*',
      '',
      `LID: ${lid || 'WhatsApp no lo entregó en este mensaje'}`,
      `Número/JID: ${phone ? `${phone}@s.whatsapp.net` : 'No se pudo resolver'}`,
      `Sender detectado: ${ctx.sender || 'desconocido'}`,
      `Rol detectado: ${role}`,
      '',
      'Para registrar un SubOwner por LID, copia los dígitos anteriores a *@lid*.'
    ]

    await ctx.sock.sendMessage(ctx.chat, { text: lines.join('\n') }, { quoted: ctx.msg })
  }
}

export const identityCommands = [automaticCodeCommand, idCommand]
