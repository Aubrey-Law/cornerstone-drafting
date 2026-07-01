/** Parse ISO date-only strings in UTC; avoids local TZ shift from `new Date('YYYY-MM-DD')`. */
export function parseDob(value: string | null | undefined): Date | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number)
    if (!y || !m || !d) return null
    return new Date(Date.UTC(y, m - 1, d))
  }
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Completed years at `now`, evaluated on the UTC calendar (legal age boundaries). */
export function ageInYearsFromDob(value: string | null | undefined, now = new Date()): number | null {
  const born = parseDob(value)
  if (!born) return null
  let age = now.getUTCFullYear() - born.getUTCFullYear()
  const monthDelta = now.getUTCMonth() - born.getUTCMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < born.getUTCDate())) {
    age--
  }
  return age
}

export function formatDateOnly(value: string): string {
  const born = parseDob(value)
  if (!born) return value
  return born.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatAgeLabel(dob: string | null | undefined): string | null {
  const age = ageInYearsFromDob(dob)
  return age === null ? null : `age ${age}`
}

export function formatDobWithAge(dob: string | null | undefined): string | null {
  if (!dob?.trim()) return null
  const formatted = formatDateOnly(dob)
  const ageLabel = formatAgeLabel(dob)
  return ageLabel ? `${formatted} (${ageLabel})` : formatted
}
