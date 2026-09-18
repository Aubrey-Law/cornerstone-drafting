import { describe, expect, it } from 'vitest'
import { IntegrationError } from '@/lib/integrations/errors'
import { centsToDecimalString, decimalToCents } from '@/lib/integrations/mercury/money'

function thrownBy(value: unknown): IntegrationError {
  try {
    decimalToCents(value)
  } catch (error) {
    return error as IntegrationError
  }
  throw new Error(`expected ${String(value)} to throw`)
}

describe('decimalToCents', () => {
  it.each([
    [725, 72500],
    [0.18, 18],
    [-12.48, -1248],
    [0, 0],
    [0.07, 7],
    ['1.10', 110],
    ['725', 72500],
    ['-0.01', -1],
    [7.25e2, 72500],
    [1e-2, 1],
    [1e6, 100000000],
  ])('converts %s to %i cents', (value, cents) => {
    expect(decimalToCents(value)).toBe(cents)
  })

  /**
   * The reason this module exists. Naive float arithmetic loses a cent here and
   * says nothing; keeping both sides of the comparison in the test makes the
   * failure mode legible to whoever reads this next.
   */
  it('detects sub-cent precision that naive float multiplication silently loses', () => {
    expect(Math.round(1.005 * 100)).toBe(100)   // the wrong answer, quietly
    expect((1.005).toFixed(2)).toBe('1.00')     // and toFixed does not save you
    expect(thrownBy(1.005).code).toBe('amount_precision')
  })

  it('rejects float noise rather than rounding it away', () => {
    expect(thrownBy(0.30000000000000004).code).toBe('amount_precision')
  })

  it.each([
    [Number.NaN], [Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY],
    [null], [undefined], ['abc'], [''], ['  '], [{}], [[]], [true],
  ])('rejects %s', value => {
    expect(thrownBy(value).code).toBe('amount_invalid')
  })

  it('rejects amounts beyond safe integer cents', () => {
    expect(thrownBy('99999999999999999999').code).toBe('amount_invalid')
  })

  it('reports every failure as an attention-level Mercury error that does not echo the value', () => {
    const error = thrownBy('4111111111111111.999')
    expect(error).toBeInstanceOf(IntegrationError)
    expect(error.provider).toBe('mercury')
    expect(error.kind).toBe('attention')
    expect(error.retryAfterMs).toBeNull()
    expect(JSON.stringify(error.safeMessage)).not.toContain('4111111111111111')
  })
})

describe('centsToDecimalString', () => {
  it.each([
    [72500, '725.00'],
    [18, '0.18'],
    [-1248, '-12.48'],
    [0, '0.00'],
    [7, '0.07'],
    [-1, '-0.01'],
  ])('renders %i cents as %s', (cents, text) => {
    expect(centsToDecimalString(cents)).toBe(text)
  })

  it('round-trips across magnitudes and signs', () => {
    for (const cents of [0, 1, -1, 7, 99, 100, 725_00, -725_00, 123_456_789, -123_456_789]) {
      expect(decimalToCents(centsToDecimalString(cents))).toBe(cents)
    }
  })

  it('refuses fractional cents', () => {
    expect(() => centsToDecimalString(12.5)).toThrow(IntegrationError)
  })
})
