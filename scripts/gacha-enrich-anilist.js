import {
  withGachaState,
  getGachaState
} from '../src/lib/gachaStore.js'

const ANILIST = 'https://graphql.anilist.co'
const delayMs = Math.max(
  900,
  Number(process.env.GACHA_ENRICH_DELAY_MS || 1200)
)

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const query = `
  query ($id: Int) {
    Character(id: $id) {
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
      description(asHtml: false)
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
`

function cleanDescription(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1200)
}

async function fetchCharacter(id) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 18000)

    try {
      const response = await fetch(ANILIST, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': 'NeroBot-Gacha-Enrich/1.12.1'
        },
        body: JSON.stringify({
          query,
          variables: { id: Number(id) }
        })
      })

      if (response.status === 429) {
        const seconds = Math.max(
          5,
          Number(response.headers.get('retry-after') || 10)
        )
        console.log(`⏳ AniList 429. Esperando ${seconds}s...`)
        await sleep(seconds * 1000)
        continue
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const json = await response.json()

      if (json?.errors?.length) {
        throw new Error(json.errors.map(x => x.message).join('; '))
      }

      return json?.data?.Character || null
    } finally {
      clearTimeout(timer)
    }
  }

  return null
}

const initial = getGachaState()
const entries = Object.values(initial.catalog || {})
  .filter(character =>
    character?.source === 'AniList' &&
    /^\d+$/.test(String(character.id))
  )

console.log(`🎴 Personajes AniList a enriquecer: ${entries.length}`)

let updated = 0
let failed = 0

for (let index = 0; index < entries.length; index += 1) {
  const existing = entries[index]

  try {
    const raw = await fetchCharacter(existing.id)

    if (!raw) {
      failed += 1
      console.warn(`⚠️ ${existing.id}: sin datos`)
      continue
    }

    const media = raw.media?.nodes?.[0]
    const title = media?.title || {}

    const patch = {
      name:
        raw.name?.full ||
        raw.name?.native ||
        existing.name,
      nativeName: raw.name?.native || '',
      aliases: [
        ...(raw.name?.alternative || []),
        raw.name?.native
      ].filter(Boolean),
      series:
        title.romaji ||
        title.english ||
        title.native ||
        existing.series ||
        'Serie no registrada',
      mediaType: media?.type || '',
      image:
        raw.image?.large ||
        raw.image?.medium ||
        existing.image ||
        '',
      favorites: Number(raw.favourites || 0),
      gender: raw.gender || '',
      age: raw.age == null ? '' : String(raw.age),
      description: cleanDescription(raw.description),
      source: 'AniList',
      enrichedAt: Date.now()
    }

    withGachaState(state => {
      const current = state.catalog?.[existing.id]
      if (!current) return

      state.catalog[existing.id] = {
        ...current,
        ...patch
      }
    })

    updated += 1
    console.log(
      `✅ ${index + 1}/${entries.length} ${patch.name} | ` +
      `${patch.gender || '?'} | edad ${patch.age || '?'} | ` +
      `❤️ ${patch.favorites}`
    )
  } catch (error) {
    failed += 1
    console.warn(
      `⚠️ ${existing.id} ${existing.name}: ${
        error?.message || error
      }`
    )
  }

  await sleep(delayMs)
}

console.log('')
console.log(`✅ Enriquecidos: ${updated}`)
console.log(`⚠️ Fallidos: ${failed}`)
console.log(
  `📚 Catálogo: ${
    Object.keys(getGachaState().catalog || {}).length
  }`
)
console.log('No se cambiaron IDs, claims ni colecciones.')
