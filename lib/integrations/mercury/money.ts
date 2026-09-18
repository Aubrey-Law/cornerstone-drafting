import { IntegrationError } from '@/lib/integrations/errors'

/**
 * Mercury speaks decimal dollars; every other money value in this app is an
 * integer count of cents. This module is the only place the two meet.
 *
 * The conversion deliberately never touches floating-point arithmetic.
 * `Math.round(1.005 * 100)` is 100, not 101, and `(1.005).toFixed(2)` is
 * "1.00" — both lose a cent silently, which is the one failure mode a billing
 * ledger cannot absorb. Working on the decimal *string* and finishing in
 * BigInt keeps the arithmetic exact.
 */

function amountFailure(code: string, safeMessage: string): IntegrationError {
  return new IntegrationError({
    provider: 'mercury', kind: 'attention', code, safeMessage, retryAfterMs: null,
  })
}

/**
 * Rewrite exponent notation as a plain decimal.
 *
 * `Number.prototype.toString` reaches for exponents at both extremes, so
 * `7.25e2` and `1e-2` are shapes a live payload can genuinely produce.
 */
function expandExponent(text: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text)
  if (!match) return text
  const [, sign, whole, fraction = '', exponent] = match
  const digits = whole + fraction
  const pointAt = whole.length + Number(exponent)
  if (pointAt <= 0) return `${sign}0.${'0'.repeat(-pointAt)}${digits}`
  if (pointAt >= digits.length) return `${sign}${digits}${'0'.repeat(pointAt - digits.length)}`
  return `${sign}${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`
}

/**
 * A Mercury decimal amount as integer cents.
 *
 * Throws rather than rounds when the value carries more than two decimal
 * places. A third decimal on a bank amount means an assumption this code rests
 * on has broken; rounding it would convert a broken assumption into quietly
 * wrong money, and quietly wrong money is what nobody ever finds.
 */
export function decimalToCents(value: unknown): number {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw amountFailure('amount_invalid', 'Mercury returned an amount in an unreadable form.')
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw amountFailure('amount_invalid', 'Mercury returned an amount that is not a finite number.')
  }

  const text = expandExponent((typeof value === 'number' ? value.toString() : value).trim())
  if (!text) throw amountFailure('amount_invalid', 'Mercury returned an empty amount.')

  const parsed = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text)
  if (!parsed) throw amountFailure('amount_invalid', 'Mercury returned an amount that is not a decimal number.')

  const [, sign, whole, fraction = ''] = parsed
  if (fraction.length > 2) {
    throw amountFailure('amount_precision', 'Mercury returned an amount with sub-cent precision.')
  }

  // BigInt calls rather than literals: the compile target is ES6.
  const magnitude = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0'))
  const cents = sign === '-' ? -magnitude : magnitude
  const safe = BigInt(Number.MAX_SAFE_INTEGER)
  if (cents > safe || cents < -safe) {
    throw amountFailure('amount_invalid', 'Mercury returned an amount outside the supported range.')
  }
  return Number(cents)
}

/**
 * Integer cents as the decimal string Mercury expects on the way back out.
 *
 * Built by integer division rather than `cents / 100` for the same reason the
 * inbound path avoids floats.
 */
export function centsToDecimalString(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw amountFailure('amount_invalid', 'Only whole cents can be sent to Mercury.')
  }
  const magnitude = Math.abs(cents)
  const whole = Math.trunc(magnitude / 100)
  const fraction = magnitude % 100
  return `${cents < 0 ? '-' : ''}${whole}.${String(fraction).padStart(2, '0')}`
}
