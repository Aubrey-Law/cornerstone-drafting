const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const MONEY_EXACT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Whole-dollar money for headline figures. */
export function money(cents: number): string {
  return MONEY.format(cents / 100)
}

/** Cent-accurate money for individual transactions. */
export function moneyExact(cents: number): string {
  return MONEY_EXACT.format(cents / 100)
}

export function percentOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

/**
 * A signed change against a prior period. `null` means there was no prior
 * figure to compare against, which reads differently from "flat".
 */
export interface Trend {
  percent: number | null
  positive: boolean
  label: string
}

/**
 * @param goodWhenUp false for figures where growth is bad news, such as costs.
 */
export function trend(
  percent: number | null,
  { goodWhenUp = true }: { goodWhenUp?: boolean } = {},
): Trend {
  if (percent === null) return { percent: null, positive: true, label: 'No prior period' }
  const rising = percent >= 0
  return {
    percent,
    positive: goodWhenUp ? rising : !rising,
    label: `${rising ? '▲' : '▼'} ${Math.abs(percent)}%`,
  }
}
