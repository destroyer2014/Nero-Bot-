const tttGames = new Map()
const movieGames = new Map()

const MOVIES = [
  { title: 'Frozen', emojis: '🧊 👸 ⛄', aliases: ['frozen'] },
  { title: 'Titanic', emojis: '🚢 🧊 💔', aliases: ['titanic'] },
  { title: 'Shrek', emojis: '🟢 👹 👸 🫏', aliases: ['shrek'] },
  { title: 'Harry Potter', emojis: '⚡ 🧙‍♂️ 🦉 🪄', aliases: ['harry potter'] },
  { title: 'El Rey León', emojis: '🦁 👑 🌅', aliases: ['el rey leon', 'rey leon', 'the lion king'] },
  { title: 'Buscando a Nemo', emojis: '🐠 🌊 🔎', aliases: ['buscando a nemo', 'finding nemo'] },
  { title: 'Toy Story', emojis: '🤠 🚀 🧸', aliases: ['toy story'] },
  { title: 'Cars', emojis: '🏎️ ⚡ 🏁', aliases: ['cars'] },
  { title: 'Coco', emojis: '💀 🎸 🌼', aliases: ['coco'] },
  { title: 'Up', emojis: '🎈 🏠 👴', aliases: ['up'] },
  { title: 'Ratatouille', emojis: '🐀 👨‍🍳 🥘', aliases: ['ratatouille'] },
  { title: 'Jurassic Park', emojis: '🦖 🏝️ 🚙', aliases: ['jurassic park'] },
  { title: 'Spider-Man', emojis: '🕷️ 🕸️ 🦸‍♂️', aliases: ['spiderman', 'spider man'] },
  { title: 'Batman', emojis: '🦇 🌃 🦸‍♂️', aliases: ['batman'] },
  { title: 'Superman', emojis: '🦸‍♂️ 🟥 🟦 🛫', aliases: ['superman'] },
  { title: 'Avengers', emojis: '🦸‍♂️ 🦸‍♀️ 💎 🌌', aliases: ['avengers', 'the avengers', 'vengadores'] },
  { title: 'Matrix', emojis: '💊 🕶️ 💻 🟩', aliases: ['matrix', 'the matrix'] },
  { title: 'Joker', emojis: '🤡 🃏 🏙️', aliases: ['joker'] },
  { title: 'Mi Villano Favorito', emojis: '🟡 👓 🍌 🦹‍♂️', aliases: ['mi villano favorito', 'despicable me'] },
  { title: 'Intensamente', emojis: '😊 😡 😢 😨 🧠', aliases: ['intensamente', 'inside out'] },
  { title: 'Moana', emojis: '🌊 🛶 🌺 🗿', aliases: ['moana', 'vaiana'] },
  { title: 'Aladdín', emojis: '🧞‍♂️ 🪔 🕌', aliases: ['aladdin', 'aladin'] },
  { title: 'La Sirenita', emojis: '🧜‍♀️ 🐚 🌊', aliases: ['la sirenita', 'the little mermaid'] },
  { title: 'Kung Fu Panda', emojis: '🐼 🥋 🐉', aliases: ['kung fu panda'] },
  { title: 'Cómo Entrenar a tu Dragón', emojis: '🐉 🧑‍🦱 🛡️', aliases: ['como entrenar a tu dragon', 'how to train your dragon'] },
  { title: 'El Conjuro', emojis: '🏚️ 👻 ✝️', aliases: ['el conjuro', 'the conjuring'] },
  { title: 'It', emojis: '🤡 🎈 🚲', aliases: ['it', 'eso'] },
  { title: 'John Wick', emojis: '🐶 🔫 🕴️', aliases: ['john wick'] },
  { title: 'Rápidos y Furiosos', emojis: '🚗 💨 🏁 👨‍👩‍👧‍👦', aliases: ['rapidos y furiosos', 'fast and furious'] },
  { title: 'Piratas del Caribe', emojis: '🏴‍☠️ ⚓ 🏝️ 🧭', aliases: ['piratas del caribe', 'pirates of the caribbean'] }
]

function normalize(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function contextInfo(ctx) {
  const m = ctx.msg?.message || {}
  return m.extendedTextMessage?.contextInfo ||
    m.imageMessage?.contextInfo ||
    m.videoMessage?.contextInfo ||
    m.documentMessage?.contextInfo ||
    m.buttonsResponseMessage?.contextInfo ||
    m.listResponseMessage?.contextInfo ||
    {}
}

function mentions(ctx) {
  return [...new Set(contextInfo(ctx)?.mentionedJid || [])]
}

function jidToken(value = '') {
  return String(value).split('@')[0].split(':')[0].replace(/\D/g, '')
}

function sameIdentity(a = '', b = '') {
  if (!a || !b) return false
  return jidToken(a) && jidToken(a) === jidToken(b)
}

function participantJid(participant = {}) {
  return participant.id || participant.jid || participant.lid || participant.phoneNumber || ''
}

async function groupMembers(ctx) {
  if (!ctx.chat.endsWith('@g.us')) throw new Error('Este comando solo funciona en grupos.')
  const metadata = await ctx.sock.groupMetadata(ctx.chat)
  const botIds = [ctx.sock.user?.id, ctx.sock.user?.jid, ctx.sock.user?.lid].filter(Boolean)
  return (metadata.participants || [])
    .map(participantJid)
    .filter(Boolean)
    .filter(jid => !botIds.some(bot => sameIdentity(bot, jid)))
}

function choose(list = []) {
  return list[Math.floor(Math.random() * list.length)]
}

function display(jid = '') {
  return `@${String(jid).split('@')[0].split(':')[0]}`
}

function stablePercent(a = '', b = '', salt = '') {
  const input = [jidToken(a), jidToken(b)].sort().join(':') + `:${salt}`
  let hash = 2166136261
  for (const ch of input) {
    hash ^= ch.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash >>> 0) % 101
}

function progress(percent) {
  const filled = Math.round(percent / 10)
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`
}

function boardText(board) {
  const cells = board.map((cell, index) => cell || `${index + 1}️⃣`)
  return [
    `${cells[0]} ${cells[1]} ${cells[2]}`,
    `${cells[3]} ${cells[4]} ${cells[5]}`,
    `${cells[6]} ${cells[7]} ${cells[8]}`
  ].join('\n')
}

function winner(board) {
  const lines = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ]
  for (const [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a]
  }
  return null
}

async function startTtt(ctx) {
  const members = await groupMembers(ctx)
  const tagged = mentions(ctx)
  let opponent = tagged.find(jid => !sameIdentity(jid, ctx.sender))

  if (!opponent) {
    const candidates = members.filter(jid => !sameIdentity(jid, ctx.sender))
    opponent = choose(candidates)
  }

  if (!opponent) throw new Error('No encontré otro jugador disponible en el grupo.')

  const game = {
    x: ctx.sender,
    o: opponent,
    turn: ctx.sender,
    board: Array(9).fill(null),
    expiresAt: Date.now() + 10 * 60 * 1000
  }
  tttGames.set(ctx.chat, game)

  await ctx.sock.sendMessage(ctx.chat, {
    text: [
      '🎮 *Tres en raya*',
      '',
      `${display(game.x)} = ❌`,
      `${display(game.o)} = ⭕`,
      '',
      boardText(game.board),
      '',
      `Turno: ${display(game.turn)}`,
      'Responde con *.ttt 1* hasta *.ttt 9*.',
      'Para cancelar: *.ttt cancelar*'
    ].join('\n'),
    mentions: [game.x, game.o]
  }, { quoted: ctx.msg })
}

export const tttCommand = {
  name: 'ttt',
  aliases: ['tresenraya', 'tateti'],
  async execute(ctx) {
    if (!ctx.chat.endsWith('@g.us')) throw new Error('Este juego solo funciona en grupos.')

    let game = tttGames.get(ctx.chat)
    if (game?.expiresAt < Date.now()) {
      tttGames.delete(ctx.chat)
      game = null
    }

    const action = String(ctx.args?.[0] || '').toLowerCase()

    if (!game) {
      await startTtt(ctx)
      return
    }

    if (['cancelar', 'cancel', 'salir'].includes(action)) {
      const allowed = sameIdentity(ctx.sender, game.x) ||
        sameIdentity(ctx.sender, game.o) ||
        ctx.isOwner ||
        ctx.isSubOwner
      if (!allowed) throw new Error('Solo los jugadores o Owner/SubOwner pueden cancelar esta partida.')
      tttGames.delete(ctx.chat)
      await ctx.sock.sendMessage(ctx.chat, { text: '🛑 Partida de tres en raya cancelada.' }, { quoted: ctx.msg })
      return
    }

    const position = Number(action)
    if (!Number.isInteger(position) || position < 1 || position > 9) {
      await ctx.sock.sendMessage(ctx.chat, {
        text: `${boardText(game.board)}\n\nTurno: ${display(game.turn)}\nUsa *.ttt 1* hasta *.ttt 9*.`,
        mentions: [game.turn]
      }, { quoted: ctx.msg })
      return
    }

    if (!sameIdentity(ctx.sender, game.turn)) {
      throw new Error(`Ahora es el turno de ${display(game.turn)}.`)
    }

    const index = position - 1
    if (game.board[index]) throw new Error('Esa casilla ya está ocupada.')

    const symbol = sameIdentity(ctx.sender, game.x) ? '❌' : '⭕'
    game.board[index] = symbol
    game.expiresAt = Date.now() + 10 * 60 * 1000

    const won = winner(game.board)
    if (won) {
      tttGames.delete(ctx.chat)
      await ctx.sock.sendMessage(ctx.chat, {
        text: `🏆 *¡Victoria!*\n\n${boardText(game.board)}\n\nGanador: ${display(ctx.sender)} ${symbol}`,
        mentions: [ctx.sender]
      }, { quoted: ctx.msg })
      return
    }

    if (game.board.every(Boolean)) {
      tttGames.delete(ctx.chat)
      await ctx.sock.sendMessage(ctx.chat, {
        text: `🤝 *Empate*\n\n${boardText(game.board)}`
      }, { quoted: ctx.msg })
      return
    }

    game.turn = sameIdentity(game.turn, game.x) ? game.o : game.x
    tttGames.set(ctx.chat, game)

    await ctx.sock.sendMessage(ctx.chat, {
      text: `${boardText(game.board)}\n\nTurno: ${display(game.turn)}`,
      mentions: [game.turn]
    }, { quoted: ctx.msg })
  }
}

export const movieCommand = {
  name: 'movie',
  aliases: ['pelicula', 'adivinapelicula'],
  async execute(ctx) {
    if (!ctx.chat.endsWith('@g.us')) throw new Error('Este juego solo funciona en grupos.')

    let game = movieGames.get(ctx.chat)
    if (game?.expiresAt < Date.now()) {
      movieGames.delete(ctx.chat)
      await ctx.sock.sendMessage(ctx.chat, {
        text: `⌛ Se acabó el tiempo. La película era *${game.movie.title}*.`
      }, { quoted: ctx.msg })
      game = null
    }

    const guess = ctx.args.join(' ').trim()

    if (!game) {
      const movie = choose(MOVIES)
      movieGames.set(ctx.chat, {
        movie,
        expiresAt: Date.now() + 2 * 60 * 1000
      })

      await ctx.sock.sendMessage(ctx.chat, {
        text: [
          '🎬 *Adivina la película*',
          '',
          movie.emojis,
          '',
          'Tienes 2 minutos.',
          'Responde con: *.movie <respuesta>*',
          'Ejemplo: *.movie Frozen*'
        ].join('\n')
      }, { quoted: ctx.msg })
      return
    }

    if (!guess) {
      await ctx.sock.sendMessage(ctx.chat, {
        text: `🎬 ${game.movie.emojis}\n\nResponde con *.movie <respuesta>*.`
      }, { quoted: ctx.msg })
      return
    }

    if (['cancelar', 'cancel'].includes(normalize(guess))) {
      movieGames.delete(ctx.chat)
      await ctx.sock.sendMessage(ctx.chat, {
        text: `🛑 Juego cancelado. La respuesta era *${game.movie.title}*.`
      }, { quoted: ctx.msg })
      return
    }

    const normalizedGuess = normalize(guess)
    const accepted = [game.movie.title, ...(game.movie.aliases || [])].map(normalize)
    if (!accepted.includes(normalizedGuess)) {
      await ctx.sock.sendMessage(ctx.chat, {
        text: '❌ No es esa. Inténtalo otra vez.'
      }, { quoted: ctx.msg })
      return
    }

    movieGames.delete(ctx.chat)
    await ctx.sock.sendMessage(ctx.chat, {
      text: `🎉 ${display(ctx.sender)} acertó.\nLa película era *${game.movie.title}*.`,
      mentions: [ctx.sender]
    }, { quoted: ctx.msg })
  }
}

export const parejaCommand = {
  name: 'pareja',
  aliases: ['ship', 'compatibilidad'],
  async execute(ctx) {
    const members = await groupMembers(ctx)
    const tagged = mentions(ctx)
    let first
    let second

    if (tagged.length >= 2) {
      ;[first, second] = tagged
    } else if (tagged.length === 1) {
      first = ctx.sender
      second = tagged[0]
    } else {
      const pool = [...members]
      first = choose(pool)
      second = choose(pool.filter(jid => !sameIdentity(jid, first)))
    }

    if (!first || !second || sameIdentity(first, second)) {
      throw new Error('Necesito dos personas distintas para calcular la pareja.')
    }

    const percent = stablePercent(first, second, 'nero-pareja')
    const phrase = percent >= 90 ? '💍 Esto parece destino.'
      : percent >= 70 ? '💞 Hay mucha química.'
      : percent >= 50 ? '💕 Puede funcionar.'
      : percent >= 30 ? '😅 Hay que trabajar esa conexión.'
      : '💔 El algoritmo pide refuerzos.'

    await ctx.sock.sendMessage(ctx.chat, {
      text: [
        '💘 *Compatibilidad de pareja*',
        '',
        `${display(first)} ❤️ ${display(second)}`,
        `${progress(percent)} *${percent}%*`,
        '',
        phrase
      ].join('\n'),
      mentions: [first, second]
    }, { quoted: ctx.msg })
  }
}

export const testGayCommand = {
  name: 'testgay',
  aliases: ['gaytest'],
  async execute(ctx) {
    const members = await groupMembers(ctx)
    const tagged = mentions(ctx)
    const target = tagged[0] || choose(members)
    if (!target) throw new Error('No encontré un usuario para el test.')

    const day = new Date().toISOString().slice(0, 10)
    const percent = stablePercent(target, day, 'nero-testgay')

    await ctx.sock.sendMessage(ctx.chat, {
      text: [
        '🏳️‍🌈 *TestGay — modo meme*',
        '',
        `${display(target)} → *${percent}%*`,
        progress(percent),
        '',
        '🎲 Resultado aleatorio de entretenimiento; no determina ni afirma la orientación sexual real de nadie.'
      ].join('\n'),
      mentions: [target]
    }, { quoted: ctx.msg })
  }
}

async function memeTarget(ctx) {
  await groupMembers(ctx)
  return mentions(ctx)[0] || ctx.sender
}

async function memePair(ctx) {
  const members = await groupMembers(ctx)
  const tagged = mentions(ctx)
  let first
  let second

  if (tagged.length >= 2) {
    ;[first, second] = tagged
  } else if (tagged.length === 1) {
    first = ctx.sender
    second = tagged[0]
  } else {
    first = ctx.sender
    second = choose(members.filter(jid => !sameIdentity(jid, first)))
  }

  if (!first || !second || sameIdentity(first, second)) {
    throw new Error('Necesito dos personas distintas para este resultado.')
  }

  return [first, second]
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function singleMemeCommand({
  name,
  aliases = [],
  title,
  emoji,
  salt,
  low,
  mid,
  high,
  note = '🎲 Resultado de entretenimiento; no afirma nada real sobre la persona.'
}) {
  return {
    name,
    aliases,
    async execute(ctx) {
      const target = await memeTarget(ctx)
      const percent = stablePercent(target, todayKey(), salt)
      const phrase = percent >= 75 ? high
        : percent >= 40 ? mid
        : low

      await ctx.sock.sendMessage(ctx.chat, {
        text: [
          `${emoji} *${title} — modo meme*`,
          '',
          `${display(target)} → *${percent}%*`,
          progress(percent),
          '',
          phrase,
          '',
          note
        ].join('\n'),
        mentions: [target]
      }, { quoted: ctx.msg })
    }
  }
}

function pairMemeCommand({
  name,
  aliases = [],
  title,
  emoji,
  salt,
  low,
  mid,
  high,
  note = '🎲 Resultado de entretenimiento.'
}) {
  return {
    name,
    aliases,
    async execute(ctx) {
      const [first, second] = await memePair(ctx)
      const percent = stablePercent(first, second, salt)
      const phrase = percent >= 75 ? high
        : percent >= 40 ? mid
        : low

      await ctx.sock.sendMessage(ctx.chat, {
        text: [
          `${emoji} *${title}*`,
          '',
          `${display(first)} + ${display(second)}`,
          `${progress(percent)} *${percent}%*`,
          '',
          phrase,
          '',
          note
        ].join('\n'),
        mentions: [first, second]
      }, { quoted: ctx.msg })
    }
  }
}

export const infielCommand = singleMemeCommand({
  name: 'infiel',
  aliases: ['infidelidad'],
  title: 'Detector de infidelidad',
  emoji: '💔',
  salt: 'nero-infiel',
  low: '😇 El detector está tranquilito.',
  mid: '👀 Nero detecta sospechas de novela.',
  high: '🚨 El detector se volvió loco.',
  note: '🎲 Es un meme; no determina ni acusa infidelidad real.'
})

export const therianCommand = singleMemeCommand({
  name: 'therian',
  aliases: ['testtherian'],
  title: 'Therianómetro',
  emoji: '🐾',
  salt: 'nero-therian',
  low: '🌿 Hoy el bosque está silencioso.',
  mid: '🐾 Hay energía salvaje por aquí.',
  high: '🌕 Nero escuchó aullar al algoritmo.',
  note: '🎲 Es solo entretenimiento; no determina si una persona es Therian.'
})

export const amistadCommand = pairMemeCommand({
  name: 'amistad',
  aliases: ['friendship', 'amigos'],
  title: 'Compatibilidad de amistad',
  emoji: '🤝',
  salt: 'nero-amistad',
  low: '😅 Todavía falta desbloquear confianza.',
  mid: '🙌 Buena amistad en construcción.',
  high: '🫂 Dúo inseparable según Nero.'
})

export const toxicoCommand = singleMemeCommand({
  name: 'toxico',
  aliases: ['toxica', 'toxicometro'],
  title: 'Toxicómetro',
  emoji: '☣️',
  salt: 'nero-toxico',
  low: '🌱 Bastante relax por hoy.',
  mid: '⚠️ Un poquito de drama.',
  high: '☢️ Nivel telenovela desbloqueado.'
})

export const celosoCommand = singleMemeCommand({
  name: 'celoso',
  aliases: ['celosa', 'celos'],
  title: 'Celosómetro',
  emoji: '😒',
  salt: 'nero-celoso',
  low: '😌 Cero preocupaciones.',
  mid: '👁️ Una miradita sospechosa.',
  high: '🛰️ Modo radar activado.'
})

export const crushCommand = pairMemeCommand({
  name: 'crush',
  aliases: ['match'],
  title: 'Crush Match',
  emoji: '💘',
  salt: 'nero-crush',
  low: '🧊 El algoritmo pide paciencia.',
  mid: '💕 Puede haber química.',
  high: '🔥 Nero ve chispas.'
})

export const intensoCommand = singleMemeCommand({
  name: 'intenso',
  aliases: ['intensa'],
  title: 'Intensómetro',
  emoji: '🔥',
  salt: 'nero-intenso',
  low: '🧊 Modo chill.',
  mid: '🌶️ Picante moderado.',
  high: '🌋 Intensidad máxima.'
})

export const maldadCommand = singleMemeCommand({
  name: 'maldad',
  aliases: ['malvado', 'malvada'],
  title: 'Medidor de maldad',
  emoji: '😈',
  salt: 'nero-maldad',
  low: '😇 Casi un angelito.',
  mid: '😏 Tiene sus momentos.',
  high: '👹 Villano final según el meme.'
})

export const inocenteCommand = singleMemeCommand({
  name: 'inocente',
  aliases: ['inocencia'],
  title: 'Medidor de inocencia',
  emoji: '😇',
  salt: 'nero-inocente',
  low: '😏 Nero tiene dudas.',
  mid: '🙂 Mitad santo, mitad caos.',
  high: '✨ Certificado de angelito meme.'
})

export const suerteCommand = singleMemeCommand({
  name: 'suerte',
  aliases: ['luck'],
  title: 'Suerte del día',
  emoji: '🍀',
  salt: 'nero-suerte',
  low: '🧿 Hoy mejor evita tentar al destino.',
  mid: '🎲 Día equilibrado.',
  high: '🌟 Hoy el RNG está de tu lado.',
  note: '🎲 Resultado de entretenimiento; cambia con el día.'
})

export const pptCommand = {
  name: 'ppt',
  aliases: ['piedrapapeltijera', 'rps'],
  async execute(ctx) {
    const user = normalize(ctx.args?.[0] || '')
    const allowed = ['piedra', 'papel', 'tijera']
    if (!allowed.includes(user)) throw new Error('Uso: .ppt piedra | papel | tijera')

    const bot = choose(allowed)
    const icons = { piedra: '🪨', papel: '📄', tijera: '✂️' }
    const result = user === bot ? '🤝 Empate'
      : (
        (user === 'piedra' && bot === 'tijera') ||
        (user === 'papel' && bot === 'piedra') ||
        (user === 'tijera' && bot === 'papel')
      ) ? '🏆 Ganaste' : '🤖 Ganó Nero'

    await ctx.sock.sendMessage(ctx.chat, {
      text: `🎮 *Piedra, papel o tijera*\n\nTú: ${icons[user]} ${user}\nNero: ${icons[bot]} ${bot}\n\n${result}`
    }, { quoted: ctx.msg })
  }
}

export const dadoCommand = {
  name: 'dado',
  aliases: ['dice'],
  async execute(ctx) {
    const value = 1 + Math.floor(Math.random() * 6)
    await ctx.sock.sendMessage(ctx.chat, { text: `🎲 El dado cayó en *${value}*.` }, { quoted: ctx.msg })
  }
}

export const monedaCommand = {
  name: 'moneda',
  aliases: ['coin', 'flip'],
  async execute(ctx) {
    const value = Math.random() < 0.5 ? 'Cara 🪙' : 'Cruz ✖️'
    await ctx.sock.sendMessage(ctx.chat, { text: `🪙 Resultado: *${value}*` }, { quoted: ctx.msg })
  }
}

export const gameCommands = [
  tttCommand,
  movieCommand,
  parejaCommand,
  testGayCommand,
  infielCommand,
  therianCommand,
  amistadCommand,
  toxicoCommand,
  celosoCommand,
  crushCommand,
  intensoCommand,
  maldadCommand,
  inocenteCommand,
  suerteCommand,
  pptCommand,
  dadoCommand,
  monedaCommand
]
