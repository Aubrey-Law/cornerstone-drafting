/**
 * Money, written the way it belongs in a sentence an attorney says to a client.
 *
 * Whole dollars: an unfunded total of $1,240,000 is a number that makes someone
 * act, and the cents on the end make it look like a computation rather than an
 * amount. Intake values are estimates anyway.
 */
export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

/** A stored `date` rendered without a timezone shifting it a day. */
export function formatDate(value: string | null): string | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toLocaleDateString(
    'en-US',
    { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' },
  )
}
