import {
  CITIZENSHIP_OPTIONS,
  CITIZENSHIP_VALUES,
  MARITAL_STATUS_OPTIONS,
  MA_COUNTY_OPTIONS,
} from './options'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function trimString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

export function normalizeMaritalStatus(raw: unknown): string | null {
  const text = trimString(raw)?.toLowerCase()
  if (!text) return null
  const match = MARITAL_STATUS_OPTIONS.find((o) => o.value === text)
  return match?.value ?? text
}

export function normalizeCounty(raw: unknown): string | null {
  const text = trimString(raw)
  if (!text) return null
  const match = MA_COUNTY_OPTIONS.find(
    (o) => o.value.toLowerCase() === text.toLowerCase(),
  )
  return match?.value ?? text
}

/** Canonical design-sheet citizenship vocabulary (+ legacy aliases). */
export function normalizeCitizenship(raw: unknown): string | null {
  if (typeof raw === 'boolean') {
    return raw ? 'US Citizen' : 'Non-Resident Alien'
  }
  const text = trimString(raw)
  if (!text) return null
  const lower = text.toLowerCase()
  if (lower === 'us citizen' || lower === 'u.s. citizen') {
    return 'US Citizen'
  }
  if (lower === 'not us citizen' || lower === 'non-us citizen' || lower === 'non us citizen') {
    return 'Non-Resident Alien'
  }
  const exact = CITIZENSHIP_OPTIONS.find((o) => o.value.toLowerCase() === lower)
  if (exact) return exact.value
  if (lower.includes('permanent')) return 'Permanent Resident'
  if (lower.includes('resident') && lower.includes('non')) return 'Non-Resident Alien'
  return CITIZENSHIP_VALUES.includes(text) ? text : text
}

export function isValidEmail(raw: unknown): boolean {
  const email = trimString(raw)
  return !!email && emailPattern.test(email)
}

export function inputTypeForControl(control: string): string {
  switch (control) {
    case 'email':
      return 'email'
    case 'tel':
      return 'tel'
    case 'date':
      return 'date'
    default:
      return 'text'
  }
}
