import config from '../../config.js'
import { apiGet, evoGet } from '../lib/api.js'

const NERO_CREDIT = 'Nero AI™ | ©ArcadiaCorps'

const clean = (value, fallback = 'No disponible') => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return text || fallback
}

const number = value => {
  const parsed = Number(String(value ?? '').replace(/,/g, ''))
  return Number.isFinite(parsed)
    ? new Intl.NumberFormat('es-PE').format(parsed)
    : clean(value)
}

const yesNo = value => value ? 'Sí' : 'No'
const handle = value =>
  String(value || '').trim().replace(/^@/, '')

const date = value => {
  if (!value) return 'No disponible'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? clean(value)
    : parsed.toLocaleDateString('es-PE', {
        timeZone: config.timezone,
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
}

const wrap = (name, aliases, execute) => ({
  name,
  aliases,
  async execute(ctx) {
    try {
      await execute(ctx)
    } catch (error) {
      await ctx.sock.sendMessage(ctx.chat, {
        text: `❌ ${error?.message || 'No se pudo consultar la cuenta.'}`
      }, { quoted: ctx.msg })
    }
  }
})

function requireHandle(
  ctx,
  example,
  { allowSpaces = false } = {}
) {
  const value = handle(
    ctx.args.join(allowSpaces ? ' ' : '')
  )

  if (!value) throw new Error(`Uso: ${example}`)
  if (!allowSpaces && /\s/.test(value)) {
    throw new Error(
      'Escribe únicamente el nombre de usuario, sin espacios.'
    )
  }
  if (value.length > 100) {
    throw new Error('El nombre de usuario es demasiado largo.')
  }
  return value
}

async function sendProfile(ctx, imageUrl, caption) {
  if (imageUrl && /^https?:\/\//i.test(imageUrl)) {
    try {
      await ctx.sock.sendMessage(
        ctx.chat,
        { image: { url: imageUrl }, caption },
        { quoted: ctx.msg }
      )
      return
    } catch (error) {
      console.warn(
        '[STALKING] No se pudo enviar la imagen:',
        error?.message || error
      )
    }
  }

  await ctx.sock.sendMessage(
    ctx.chat,
    { text: caption },
    { quoted: ctx.msg }
  )
}

export const githubStalk = wrap(
  'githubstalk',
  ['ghstalk', 'githubinfo'],
  async ctx => {
    const username = requireHandle(
      ctx,
      '.githubstalk <usuario>'
    )
    const data = await evoGet('/stalking/github', { username })
    const result = data?.result

    if (!result?.username) {
      throw new Error(
        'GitHub no devolvió información para ese usuario.'
      )
    }

    const languages = Array.isArray(result.top_languages)
      ? result.top_languages.slice(0, 5)
          .map(item =>
            `${clean(item.language)} (${number(item.repos)} repos)`
          )
          .join(', ')
      : 'No disponible'

    const repositories = Array.isArray(result.top_repos)
      ? result.top_repos.slice(0, 5)
          .map((repo, index) =>
            `${index + 1}. ${clean(repo.name)} • ⭐ ${number(repo.stars)} • 🍴 ${number(repo.forks)}${repo.language ? ` • ${repo.language}` : ''}`
          )
          .join('\n')
      : 'No disponible'

    const caption = [
      '🔎 *GitHub público*',
      '',
      `Usuario: ${clean(result.username)}`,
      `Nombre: ${clean(result.name)}`,
      `Biografía: ${clean(result.bio)}`,
      `Empresa: ${clean(result.company)}`,
      `Ubicación: ${clean(result.location)}`,
      `Blog: ${clean(result.blog)}`,
      `Perfil: ${clean(result.profile_url)}`,
      '',
      `Seguidores: ${number(result.stats?.followers)}`,
      `Siguiendo: ${number(result.stats?.following)}`,
      `Repositorios públicos: ${number(result.stats?.public_repos)}`,
      `Estrellas totales: ${number(result.stats?.total_stars)}`,
      `Forks totales: ${number(result.stats?.total_forks)}`,
      `Cuenta creada: ${date(result.account?.created_at)}`,
      `Lenguajes principales: ${languages}`,
      '',
      '*Repositorios principales*',
      repositories,
      '',
      '> Solo se muestran datos públicos.'
    ].join('\n')

    await sendProfile(ctx, result.avatar, caption)
  }
)

export const instagramStalk = wrap(
  'instagramstalk',
  ['instastalk', 'igstalk'],
  async ctx => {
    const username = requireHandle(
      ctx,
      '.instagramstalk <usuario>'
    )
    const data = await evoGet('/stalking/instagram', { username })
    const result = data?.result

    if (!result?.username) {
      throw new Error(
        'Instagram no devolvió información para ese usuario.'
      )
    }

    const caption = [
      '🔎 *Instagram público*',
      '',
      `Usuario: @${clean(result.username)}`,
      `Nombre: ${clean(result.full_name)}`,
      `Biografía: ${clean(result.biography)}`,
      `Cuenta privada: ${yesNo(result.is_private)}`,
      `Publicaciones: ${number(result.statistics?.posts)}`,
      `Seguidores: ${number(result.statistics?.followers)}`,
      `Siguiendo: ${number(result.statistics?.following)}`,
      '',
      '> Solo se muestran datos públicos.'
    ].join('\n')

    await sendProfile(ctx, result.profile_pic, caption)
  }
)

export const robloxStalk = wrap(
  'robloxstalk',
  ['rbstalk', 'robloxinfo'],
  async ctx => {
    const username = requireHandle(
      ctx,
      '.robloxstalk <usuario>'
    )
    const data = await evoGet('/stalking/roblox', { username })
    const result = data?.data

    if (!result?.account?.username) {
      throw new Error(
        'Roblox no devolvió información para ese usuario.'
      )
    }

    const account = result.account
    const presence = result.presence || {}
    const stats = result.stats || {}
    const badges =
      Array.isArray(result.badges) && result.badges.length
        ? result.badges.slice(0, 10)
            .map(item => clean(item?.name || item))
            .join(', ')
        : 'Ninguna'

    const caption = [
      '🔎 *Roblox público*',
      '',
      `Usuario: ${clean(account.username)}`,
      `Nombre visible: ${clean(account.displayName)}`,
      `ID: ${clean(account.id)}`,
      `Descripción: ${clean(account.description)}`,
      `Cuenta creada: ${date(account.created)}`,
      `Suspendida: ${yesNo(account.isBanned)}`,
      `Insignia verificada: ${yesNo(account.hasVerifiedBadge)}`,
      `En línea: ${yesNo(presence.isOnline)}`,
      `Última conexión: ${presence.lastOnline === 'Not available' ? 'No disponible' : clean(presence.lastOnline)}`,
      `Ubicación visible: ${clean(presence.location)}`,
      `Amigos: ${number(stats.friends)}`,
      `Seguidores: ${number(stats.followers)}`,
      `Siguiendo: ${number(stats.following)}`,
      `Insignias: ${badges}`,
      '',
      '> Solo se muestran datos públicos.'
    ].join('\n')

    await sendProfile(ctx, account.profilePicture, caption)
  }
)

export const telegramStalk = wrap(
  'telegramstalk',
  ['tgstalk', 'telegraminfo'],
  async ctx => {
    const channel = requireHandle(
      ctx,
      '.telegramstalk <usuario_del_canal>'
    )
    const data = await evoGet('/stalking/telegram', { channel })
    const result = data?.data

    if (
      !result ||
      (
        !result.title &&
        !result.username &&
        !result.subscribers &&
        !(result.messages || []).length
      )
    ) {
      throw new Error(
        'Telegram no devolvió información. Usa el username público del canal, sin @ ni espacios.'
      )
    }

    const messages =
      Array.isArray(result.messages) && result.messages.length
        ? result.messages.slice(0, 5)
            .map((item, index) =>
              `${index + 1}. ${clean(item?.text || item?.message || item)}`
            )
            .join('\n')
        : 'No disponibles'

    const caption = [
      '🔎 *Telegram público*',
      '',
      `Canal: ${clean(result.title)}`,
      `Usuario: ${result.username ? `@${clean(result.username)}` : 'No disponible'}`,
      `Descripción: ${clean(result.description)}`,
      `Suscriptores: ${number(result.subscribers)}`,
      `Enlace: ${clean(result.url)}`,
      '',
      '*Mensajes recientes*',
      messages,
      '',
      '> Solo se muestran datos públicos.'
    ].join('\n')

    await ctx.sock.sendMessage(
      ctx.chat,
      { text: caption },
      { quoted: ctx.msg }
    )
  }
)

export const tiktokStalk = wrap(
  'tiktokstalk',
  ['ttstalk', 'tiktokinfo'],
  async ctx => {
    const username = requireHandle(
      ctx,
      '.tiktokstalk <usuario>'
    )
    const data = await evoGet('/stalking/tiktok', { username })
    const result = data?.result

    if (!result?.username) {
      throw new Error(
        'TikTok no devolvió información para ese usuario.'
      )
    }

    const videos =
      Array.isArray(result.recent_videos) &&
      result.recent_videos.length
        ? result.recent_videos.slice(0, 5)
            .map((item, index) =>
              `${index + 1}. ${clean(item?.title || item?.description || item?.url || item)}`
            )
            .join('\n')
        : 'No disponibles'

    const caption = [
      '🔎 *TikTok público*',
      '',
      `Usuario: @${clean(result.username)}`,
      `Nombre: ${clean(result.nickname)}`,
      `Biografía: ${clean(result.signature)}`,
      `Verificada: ${yesNo(result.verified)}`,
      `Cuenta privada: ${yesNo(result.private_account)}`,
      `Perfil: ${clean(result.profile_url)}`,
      `Región pública: ${clean(result.account_region)}`,
      `Cuenta comercial: ${yesNo(result.commerce_user)}`,
      `Seguidores: ${number(result.stats?.followers)}`,
      `Siguiendo: ${number(result.stats?.following)}`,
      `Me gusta: ${number(result.stats?.likes)}`,
      `Videos: ${number(result.stats?.videos)}`,
      '',
      '*Videos recientes*',
      videos,
      '',
      '> Solo se muestran datos públicos.'
    ].join('\n')

    await sendProfile(ctx, result.avatar, caption)
  }
)

export const freeFireStalk = wrap(
  'ffstalk',
  ['freefirestalk', 'ffprofile', 'freefireprofile'],
  async ctx => {
    const id = String(ctx.args?.[0] || '')
      .replace(/\D/g, '')
      .trim()

    const region = String(ctx.args?.[1] || 'us')
      .trim()
      .toLowerCase()

    if (id.length < 5 || id.length > 20) {
      throw new Error(
        'Uso: .ffstalk <ID de Free Fire> [región]'
      )
    }

    if (!/^[a-z]{2,5}$/.test(region)) {
      throw new Error(
        'La región debe escribirse con letras, por ejemplo: us, br o sg.'
      )
    }

    const data = await apiGet(
      '/freefire/profile',
      { id, region },
      { timeoutMs: 120_000 }
    )

    const result = data?.result
    if (!result?.player_id) {
      throw new Error(
        'No encontré un perfil público de Free Fire para ese ID.'
      )
    }

    const caption = [
      '🔥 *FREE FIRE • PERFIL*',
      '',
      `👤 Nick: *${clean(result.nick)}*`,
      `🆔 ID: *${clean(result.player_id)}*`,
      `🌎 Región: *${region.toUpperCase()}*`,
      `⭐ Nivel: ${clean(result.level)}`,
      `❤️ Likes: ${clean(result.likes)}`,
      `✨ Experiencia: ${clean(result.experience)}`,
      `🏰 Guild: ${clean(result.guild)}`,
      '',
      `🏆 Battle Royale: *${clean(result.rank_br)}*`,
      `⚔️ Clash Squad: *${clean(result.rank_cs)}*`,
      `📅 Cuenta creada: ${clean(result.created_at)}`,
      '',
      '> Solo se muestran datos públicos.',
      `> ${NERO_CREDIT}`
    ].join('\n')

    // download_pdf_url se ignora: puede contener DVYER_API_KEY.
    await sendProfile(ctx, result.banner_url, caption)
  }
)

export const stalkingCommands = [
  githubStalk,
  instagramStalk,
  robloxStalk,
  telegramStalk,
  tiktokStalk,
  freeFireStalk
]
