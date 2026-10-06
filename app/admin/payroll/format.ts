import { formatCents, parseDollarsToCents } from '@/lib/payroll/money'

export const usd = formatCents

export function dollarsInput(cents: number | null | undefined): string {
  if (cents == null) return ''
  return (cents / 100).toFixed(2)
}

export function parseDollars(text: string): number | null {
  return text.trim() === '' ? null : parseDollarsToCents(text)
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function percentInput(micros: number): string {
  return String(Number((micros / 10_000).toFixed(4)))
}

export function parsePercent(text: string): number | null {
  const value = Number(text.trim())
  if (text.trim() === '' || !Number.isFinite(value) || value < 0 || value > 100) return null
  return Math.round(value * 10_000)
}
