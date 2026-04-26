// Pixel-art 8-bit lip/viseme shapes for mouth pieces.
// Each shape is a 64×40 SVG grid of coloured rectangles.

export type VisemeShape = 'rest' | 'bmp' | 'wide' | 'open' | 'round' | 'fv' | 'ch' | 'tldn'

// Map a word's first phoneme → its dominant viseme shape
export function getWordViseme(word: string): VisemeShape {
  const w = word.toLowerCase().trim()
  const c1 = w[0] ?? ''
  const c2 = w.slice(0, 2)

  if (c2 === 'th')              return 'ch'   // Th
  if (c2 === 'ch' || c2 === 'sh') return 'ch' // Ch_J / S_Z family
  if ('bmp'.includes(c1))       return 'bmp'  // B_M_P
  if ('fv'.includes(c1))        return 'fv'   // F_V
  if (c1 === 'w')               return 'round' // W_OO
  if (c1 === 'r')               return 'round' // R
  if ('ou'.includes(c1))        return 'round' // Oh / W_OO
  if ('aey'.includes(c1))       return 'wide'  // AE / EE
  if ('i'.includes(c1))         return 'wide'  // Ih
  if ('sz'.includes(c1))        return 'wide'  // S_Z
  if ('tldn'.includes(c1))      return 'tldn'  // T_L_D_N
  if ('kgh'.includes(c1))       return 'open'  // K_G_H_NG
  return 'rest'
}

// ── Colour constants ──────────────────────────────────────────────────────────

const L = '#a03050'   // lip dark
const M = '#c85080'   // lip mid
const H = '#f080b0'   // lip highlight
const T = '#e8e8e0'   // teeth
const C = '#180010'   // mouth cavity
const O = '#0d0d0d'   // outline
const G = '#d04060'   // tongue

// ── Shared props ──────────────────────────────────────────────────────────────

type P = { className?: string }
const V = '0 0 64 40'

// ── REST — thin neutral closed ────────────────────────────────────────────────
export function MouthRest({ className }: P) {
  return (
    <svg viewBox={V} className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="6"  y="13" width="52" height="14" fill={O} />
      <rect x="8"  y="14" width="48" height="6"  fill={M} />
      <rect x="10" y="15" width="44" height="2"  fill={H} />
      <rect x="8"  y="21" width="48" height="5"  fill={L} />
    </svg>
  )
}

// ── BMP — pressed lips ────────────────────────────────────────────────────────
export function MouthBMP({ className }: P) {
  return (
    <svg viewBox={V} className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="4"  y="8"  width="56" height="24" fill={O} />
      <rect x="6"  y="9"  width="52" height="10" fill={M} />
      <rect x="8"  y="10" width="48" height="4"  fill={H} />
      <rect x="4"  y="19" width="56" height="2"  fill={O} />
      <rect x="6"  y="21" width="52" height="9"  fill={L} />
    </svg>
  )
}

// ── WIDE — open smile, teeth showing (AE / EE / S_Z / Ih) ────────────────────
export function MouthWide({ className }: P) {
  return (
    <svg viewBox={V} className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="2"  y="3"  width="60" height="34" fill={O} />
      <rect x="4"  y="4"  width="56" height="9"  fill={M} />
      <rect x="6"  y="5"  width="52" height="3"  fill={H} />
      <rect x="4"  y="12" width="56" height="7"  fill={T} />
      {/* tooth dividers */}
      <rect x="18" y="12" width="2" height="7" fill={O} />
      <rect x="32" y="12" width="2" height="7" fill={O} />
      <rect x="46" y="12" width="2" height="7" fill={O} />
      <rect x="4"  y="19" width="56" height="8"  fill={C} />
      <rect x="4"  y="27" width="56" height="8"  fill={L} />
    </svg>
  )
}

// ── OPEN — open oval (Ah / K_G_H_NG / Er) ────────────────────────────────────
export function MouthOpen({ className }: P) {
  return (
    <svg viewBox={V} className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="1"  width="44" height="38" fill={O} />
      <rect x="12" y="2"  width="40" height="9"  fill={M} />
      <rect x="14" y="3"  width="36" height="3"  fill={H} />
      <rect x="12" y="10" width="40" height="18" fill={C} />
      <rect x="12" y="28" width="40" height="9"  fill={L} />
    </svg>
  )
}

// ── ROUND — pucker (Oh / W_OO / R) ───────────────────────────────────────────
export function MouthRound({ className }: P) {
  return (
    <svg viewBox={V} className={className} xmlns="http://www.w3.org/2000/svg">
      {/* side puckers */}
      <rect x="10" y="6"  width="44" height="28" fill={O} />
      <rect x="8"  y="10" width="6"  height="20" fill={L} />
      <rect x="50" y="10" width="6"  height="20" fill={L} />
      <rect x="12" y="3"  width="40" height="10" fill={M} />
      <rect x="14" y="4"  width="36" height="4"  fill={H} />
      <rect x="18" y="12" width="28" height="16" fill={C} />
      <rect x="12" y="27" width="40" height="9"  fill={L} />
    </svg>
  )
}

// ── FV — upper teeth on lower lip ────────────────────────────────────────────
export function MouthFV({ className }: P) {
  return (
    <svg viewBox={V} className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="2"  y="3"  width="60" height="34" fill={O} />
      <rect x="4"  y="4"  width="56" height="13" fill={T} />
      {/* bite line */}
      <rect x="4"  y="16" width="56" height="2"  fill={O} />
      <rect x="4"  y="17" width="56" height="18" fill={M} />
      <rect x="6"  y="18" width="52" height="6"  fill={H} />
    </svg>
  )
}

// ── CH — ch/sh/th (slight open, rounded) ─────────────────────────────────────
export function MouthCH({ className }: P) {
  return (
    <svg viewBox={V} className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="4"  y="5"  width="56" height="30" fill={O} />
      <rect x="6"  y="6"  width="52" height="9"  fill={M} />
      <rect x="8"  y="7"  width="48" height="3"  fill={H} />
      <rect x="10" y="14" width="44" height="10" fill={C} />
      <rect x="6"  y="23" width="52" height="10" fill={L} />
    </svg>
  )
}

// ── TLDN — tongue tip at teeth (T/L/D/N) ─────────────────────────────────────
export function MouthTLDN({ className }: P) {
  return (
    <svg viewBox={V} className={className} xmlns="http://www.w3.org/2000/svg">
      <rect x="2"  y="3"  width="60" height="34" fill={O} />
      <rect x="4"  y="4"  width="56" height="9"  fill={M} />
      <rect x="6"  y="5"  width="52" height="3"  fill={H} />
      <rect x="4"  y="12" width="56" height="16" fill={C} />
      {/* tongue tip */}
      <rect x="20" y="21" width="24" height="6"  fill={G} />
      <rect x="22" y="22" width="20" height="2"  fill={H} />
      <rect x="4"  y="27" width="56" height="9"  fill={L} />
    </svg>
  )
}

// ── Lookup map ────────────────────────────────────────────────────────────────

export const MOUTH_SVG: Record<VisemeShape, (props: P) => React.ReactElement> = {
  rest:  MouthRest,
  bmp:   MouthBMP,
  wide:  MouthWide,
  open:  MouthOpen,
  round: MouthRound,
  fv:    MouthFV,
  ch:    MouthCH,
  tldn:  MouthTLDN,
}

export function WordMouth({ word, className }: { word: string; className?: string }) {
  const shape = getWordViseme(word)
  const Component = MOUTH_SVG[shape]
  return <Component className={className} />
}
