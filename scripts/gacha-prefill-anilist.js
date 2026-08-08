import {
  withGachaState,
  getGachaState
} from '../src/lib/gachaStore.js'

const ANILIST = 'https://graphql.anilist.co'

const pageCount = Math.max(1, Math.min(60, Number(process.argv[2] || 12)))
const perPage = 15
const delayMs = Math.max(
  1800,
  Number(process.env.GACHA_PREFILL_DELAY_MS || 2500)
)

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const clamp = (n, min, max) => Math.max(min, Math.min(max, n))

function rarityFromFavorites(favorites = 0) {
  const f = Number(favorites) || 0
  if (f >= 100000) return 6
  if (f >= 40000) return 5
  if (f >= 12000) return 4
  if (f >= 3000) return 3
  if (f >= 500) return 2
  return 1
}

function valueFromCharacter(rarity, favorites = 0) {
  const base = [0, 80, 180, 450, 1100, 3200, 9000][rarity] || 80
  return base + Math.min(5000, Math.floor((Number(favorites) || 0) / 20))
}

const query = `
  query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      characters {
        id
        name {
          full
          native
          alternative
        }
        image {
          large
          medium
        }
        gender
        age
        favourites
        media(sort: POPULARITY_DESC, perPage: 1) {
          nodes {
            title {
              romaji
              english
              native
            }
            type
          }
        }
      }
    }
  }
`

async function fetchPage(page) {
  let lastError = null

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)

    try {
      const response = await fetch(ANILIST, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': 'NeroBot-Gacha-Prefill/1.12'
        },
        body: JSON.stringify({
          query,
          variables: { page, perPage }
        })
      })

      if (response.status === 429) {
        const retryAfter = Math.max(
          5,
          Number(response.headers.get('retry-after') || 10)
        )
        console.log(`⏳ AniList 429. Esperando ${retryAfter}s...`)
        await sleep(retryAfter * 1000)
        continue
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const json = await response.json()

      if (json?.errors?.length) {
        throw new Error(json.errors.map(x => x.message).join('; '))
      }

      return json?.data?.Page?.characters || []
    } catch (error) {
      lastError = error
      if (attempt < 3) await sleep(attempt * 1500)
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError || new Error('AniList no respondió.')
}

function normalize(raw) {
  const favorites = Number(raw?.favourites || 0)
  const rarity = clamp(rarityFromFavorites(favorites), 1, 6)
  const media = raw?.media?.nodes?.[0]
  const title = media?.title || {}

  return {
    id: String(raw.id),
    name: raw?.name?.full || raw?.name?.native || `Personaje ${raw.id}`,
    series:
      title.romaji ||
      title.english ||
      title.native ||
      'Serie no registrada',
    image: raw?.image?.large || raw?.image?.medium || '',
    favorites,
    rarity,
    value: valueFromCharacter(rarity, favorites),
    aliases: [
      ...(raw?.name?.alternative || []),
      raw?.name?.native
    ].filter(Boolean),
    source: 'AniList',
    limited: false,
    event: null,
    addedAt: Date.now()
  }
}

const usedPages = new Set()
let imported = 0

for (let index = 0; index < pageCount; index += 1) {
  let page
  do {
    page = Math.floor(Math.random() * 600) + 1
  } while (usedPages.has(page))
  usedPages.add(page)

  try {
    const rows = await fetchPage(page)
    const characters = rows.map(normalize).filter(
      character => character.id && character.name && character.image
    )

    withGachaState(state => {
      state.catalog ||= {}
      for (const character of characters) {
        state.catalog[character.id] = {
          ...(state.catalog[character.id] || {}),
          ...character
        }
      }
    })

    imported += characters.length
    const current = Object.keys(getGachaState().catalog || {}).length
    console.log(
      `✅ AniList página ${page}: +${characters.length} | catálogo: ${current}`
    )
  } catch (error) {
    console.warn(`⚠️ AniList página ${page}: ${error?.message || error}`)
  }

  await sleep(delayMs)
}

console.log('')
console.log(`🎴 Prefill terminado. Importados/actualizados: ${imported}`)
console.log(
  `📚 Catálogo total: ${Object.keys(getGachaState().catalog || {}).length}`
)
console.log('✅ .w puede usar el catálogo sin consultar APIs.')
