import { DEFAULT_CONFIG, type PoemConfig } from './protocol.ts'

export type MouthVariant = {
  id: string
  label: string
  source: string
  isCorrect: boolean
}

export type Wave = {
  id: number
  targets: string[]
  mouths: MouthVariant[]
}

export const WAVE_SIZE = 4
export const AUDIENCE_DELAY_MS = 1200

function hashSeed(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededShuffle<T>(items: T[], seedValue: string) {
  const copy = [...items]
  let seed = hashSeed(seedValue)

  for (let index = copy.length - 1; index > 0; index -= 1) {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822519)
    const swapIndex = Math.abs(seed) % (index + 1)
    ;[copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]]
  }

  return copy
}

export function chunkWords(words: string[], size: number) {
  const groups: string[][] = []
  for (let index = 0; index < words.length; index += size) {
    groups.push(words.slice(index, index + size))
  }
  return groups
}

// sessionSeed changes on every reset → different 2 variants from the pool each game
export function buildWaves(config: PoemConfig = DEFAULT_CONFIG, sessionSeed: number = 0) {
  return chunkWords(config.poem, WAVE_SIZE).map((targets, index) => {
    const waveId = index + 1

    const mouths = seededShuffle(
      targets.flatMap((target) => {
        const pool = config.variants[target] ?? []
        // Shuffle the variant pool with the session seed so we get different picks each game
        const shuffledPool = seededShuffle(pool, `${sessionSeed}-${target}`)
        const picked = shuffledPool.slice(0, 2)

        return [
          {
            id: `${waveId}-${target}-correct`,
            label: target,
            source: target,
            isCorrect: true,
          },
          ...picked.map((label) => ({
            id: `${waveId}-${target}-${label}`,
            label,
            source: target,
            isCorrect: false,
          })),
        ]
      }),
      `${config.title}-${waveId}-${targets.join('-')}-${sessionSeed}`,
    )

    return {
      id: waveId,
      targets,
      mouths,
    } satisfies Wave
  })
}

export function getMouthPosition(index: number, _count: number) {
  // 4 cols × 3 rows for up to 12 cards (4 words × 3 options)
  const columns = 4
  const column = index % columns
  const row = Math.floor(index / columns)

  // Spread from 8% to 84%, equal spacing
  const leftPct = 8 + column * (76 / (columns - 1))

  // Stagger alternate columns by 20px so cards slightly overlap at a diagonal
  const stagger = column % 2 === 1 ? 20 : 0
  const top = 14 + row * 100 + stagger

  // Gentle tilt
  const rotate = (column - 1.5) * 2 * (row % 2 === 0 ? 1 : -1)

  return { left: `${leftPct}%`, top: `${top}px`, rotate }
}

export function getVisemeFrames(text: string) {
  const source = text.trim()
  if (!source) {
    return ['flat']
  }

  return source
    .split('')
    .map((character) => {
      const lower = character.toLowerCase()
      if (/[bmp]/.test(lower)) return 'closed'
      if (/[fv]/.test(lower)) return 'bite'
      if (/[ouw]/.test(lower)) return 'round'
      if (/[eaaiy]/.test(lower)) return 'wide'
      if (lower === ' ') return 'rest'
      return 'flat'
    })
    .filter(Boolean)
}
