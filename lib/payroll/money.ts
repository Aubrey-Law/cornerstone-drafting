/**
 * Exact money arithmetic for payroll. Rates are integer millionths, so a
 * product of cents and a rate is exact in BigInt; the single rounding step is
 * half-up to the cent, which is what Excel's ROUND does for positive values.
 */

export const MICROS = 1_000_000

/** round(a * b / d), half away from zero, exact. */
export function mulDivRound(a: number, b: number, d: number): number {
  if (d === 0) throw new Error('Division by zero')
  const ZERO = BigInt(0)
  const ONE = BigInt(1)
  const TWO = BigInt(2)
  const num = BigInt(Math.round(a)) * BigInt(Math.round(b))
  const den = BigInt(Math.round(d))
  const negative = (num < ZERO) !== (den < ZERO)
  const n = num < ZERO ? -num : num
  const m = den < ZERO ? -den : den
  const q = n / m
  const r = n % m
  const rounded = r * TWO >= m ? q + ONE : q
  return Number(negative ? -rounded : rounded)
}

/** Cents times a rate in micros, rounded to the cent. */
export function applyRate(cents: number, rateMicros: number): number {
  return mulDivRound(cents, rateMicros, MICROS)
}

/** A decimal rate (0.062) as micros (62000). */
export function rateToMicros(rate: number | string | null | undefined): number {
  const value = typeof rate === 'string' ? Number(rate) : rate ?? 0
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.round(value * MICROS)
}

/** Micros back to a decimal rate for storage and display. */
export function microsToRate(micros: number): number {
  return Number((micros / MICROS).toFixed(6))
}

/** "1,234.56" or "1234.5" or "$1,234" as cents; null when it is not a money amount. */
export function parseDollarsToCents(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null
  const [whole, fraction = ''] = cleaned.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}

/** Plain two-decimal dollars for CSV and PDF ("1234.56"). */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** "$1,234.56" */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100).toLocaleString('en-US')
  return `${sign}$${whole}.${String(abs % 100).padStart(2, '0')}`
}
