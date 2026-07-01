/**
 * WCAG 2.1 contrast utilities for theme token validation.
 * AA: 4.5:1 normal text, 3:1 large text (18px+ or 14px+ bold).
 */

const RE_OKLCH = /oklch\(\s*([\d.]+)(?:\s+([\d.]+))?(?:\s+([\d.]+))?\s*\)/i
const RE_HEX = /^#([0-9a-f]{3,8})$/i

export type Oklch = { l: number; c: number; h: number }

/** Parse oklch(), #rgb, #rrggbb into linear sRGB [0,1]. */
export function parseColor(input: string): [number, number, number] {
  const trimmed = input.trim()
  const oklchMatch = trimmed.match(RE_OKLCH)
  if (oklchMatch) {
    return oklchToRgb({
      l: Number(oklchMatch[1]),
      c: Number(oklchMatch[2] ?? 0),
      h: Number(oklchMatch[3] ?? 0),
    })
  }
  const hexMatch = trimmed.match(RE_HEX)
  if (hexMatch) {
    return hexToRgb(hexMatch[1])
  }
  if (trimmed.startsWith('rgba') || trimmed.startsWith('rgb')) {
    return parseRgbFunction(trimmed)
  }
  throw new Error(`Unsupported color format: ${input}`)
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  const n = Number.parseInt(h.slice(0, 6), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function parseRgbFunction(value: string): [number, number, number] {
  const nums = value.match(/[\d.]+/g)?.map(Number) ?? []
  if (nums.length < 3) throw new Error(`Invalid rgb(): ${value}`)
  return [nums[0] / 255, nums[1] / 255, nums[2] / 255]
}

function oklchToRgb({ l, c, h }: Oklch): [number, number, number] {
  const hRad = (h * Math.PI) / 180
  const a = c * Math.cos(hRad)
  const b = c * Math.sin(hRad)
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b
  const l3 = l_ ** 3
  const m3 = m_ ** 3
  const s3 = s_ ** 3
  return [
    clamp01(+4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    clamp01(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    clamp01(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  ]
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Contrast ratio between two CSS color strings (1–21). */
export function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(parseColor(foreground))
  const l2 = relativeLuminance(parseColor(background))
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

export const WCAG_AA_NORMAL = 4.5
export const WCAG_AA_LARGE = 3

export function meetsWcagAA(
  foreground: string,
  background: string,
  largeText = false,
): boolean {
  const min = largeText ? WCAG_AA_LARGE : WCAG_AA_NORMAL
  return contrastRatio(foreground, background) >= min
}
