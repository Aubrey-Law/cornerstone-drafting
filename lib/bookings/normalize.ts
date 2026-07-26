export function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = stringValue(value)
    if (text) return text
  }
  return null
}

export function splitAttendeeName(
  name: string | null,
  email: string,
): { firstName: string; lastName: string } {
  const cleaned = name?.replace(/\s+/g, ' ').trim()
  if (cleaned) {
    const parts = cleaned.split(' ')
    return {
      firstName: parts[0] ?? 'Unknown',
      lastName: parts.slice(1).join(' ') || 'Unknown',
    }
  }

  const localPart = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim()
  if (localPart) {
    const parts = localPart.split(/\s+/)
    return {
      firstName: parts[0] ?? 'Unknown',
      lastName: parts.slice(1).join(' ') || 'Unknown',
    }
  }

  return { firstName: 'Unknown', lastName: 'Unknown' }
}

export function formatAppointmentDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
