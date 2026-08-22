/**
 * WCAG contrast for the theme's own colour tokens.
 *
 * `contrastPairs` and `statusContrastPairs` have carried the comment "must meet
 * WCAG AA (4.5:1)" since they were written, with nothing anywhere that checked
 * it. That is how the task queue's Plan pill shipped at 1.15:1 — light grey text
 * on a light grey chip, unreadable in both themes.
 *
 * Tokens are written as hex or as `oklch(L C H)`, so both have to resolve here.
 */

/** sRGB channels in 0–1. */
type Rgb = [number, number, number]

function hexToRgb(hex: string): Rgb | null {
  const value = hex.trim().replace('#', '')
  const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ]
}

/** Undo the sRGB transfer function. Negative inputs keep their sign. */
function toLinear(channel: number): number {
  const sign = channel < 0 ? -1 : 1
  const c = Math.abs(channel)
  return sign * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
}

function toGamma(channel: number): number {
  const sign = channel < 0 ? -1 : 1
  const c = Math.abs(channel)
  return sign * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
}

/** oklch(L C H) → sRGB, via Oklab and linear sRGB (Björn Ottosson's matrices). */
function oklchToRgb(value: string): Rgb | null {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i.exec(value.trim())
  if (!match) return null
  const [lightness, chroma, hueDegrees] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const hue = (hueDegrees * Math.PI) / 180
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)

  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3

  return [
    toGamma(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ]
}

/** Parse a token's colour. Returns null for anything neither hex nor oklch. */
export function parseColor(value: string): Rgb | null {
  return value.trim().startsWith('oklch') ? oklchToRgb(value) : hexToRgb(value)
}

export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(channel => toLinear(Math.min(1, Math.max(0, channel))))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.1 contrast ratio, 1–21. Throws on a colour it cannot parse, because
 *  a silently skipped pair is exactly how the unreadable pill went unnoticed. */
export function contrastRatio(foreground: string, background: string): number {
  const fg = parseColor(foreground)
  const bg = parseColor(background)
  if (!fg) throw new Error(`Unparseable colour: ${foreground}`)
  if (!bg) throw new Error(`Unparseable colour: ${background}`)
  const [hi, lo] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a)
  return (hi + 0.05) / (lo + 0.05)
}
