const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export function normalizeTargetSigningDate(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (DATE_ONLY.test(trimmed)) {
    const normalized = `${trimmed}T12:00:00.000Z`
    return Number.isNaN(Date.parse(normalized)) ? null : normalized
  }
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function targetSigningDateInput(value: string | null | undefined): string {
  if (!value) return ''
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] ?? ''
}
