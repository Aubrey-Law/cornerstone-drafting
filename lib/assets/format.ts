export function formatAssetCurrency(value: number | null | undefined): string {
  const n = Number(value) || 0
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)
}

export function parseCurrencyInput(raw: string): number {
  const cleaned = raw.replace(/[^0-9.]/g, '')
  const num = parseFloat(cleaned)
  return Number.isNaN(num) ? 0 : num
}
