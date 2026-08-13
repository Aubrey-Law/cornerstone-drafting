export type PracticeAreaCode = 'EP' | 'EP-LP' | 'CP' | 'Probate'

export const PRACTICE_AREA_OPTIONS: { value: PracticeAreaCode; label: string }[] = [
  { value: 'EP', label: 'Estate Planning' },
  { value: 'EP-LP', label: 'Estate Planning - LP' },
  { value: 'CP', label: 'College Preparation Plan' },
  { value: 'Probate', label: 'Probate' },
]

const LEGACY_PRACTICE_AREA_VALUES: Record<string, PracticeAreaCode> = {
  'Estate Planning': 'EP',
  'Estate Planning (LP)': 'EP-LP',
  'Estate Planning | LP': 'EP-LP',
  'Estate Planning - LP': 'EP-LP',
  'Estate Planning-LP': 'EP-LP',
  'College Preparation Plan': 'CP',
  'College Prep': 'CP',
  'College Prep Plan': 'CP',
  Probate: 'Probate',
  'Probate (LP)': 'Probate',
  PROBATE: 'Probate',
}

export function parsePracticeArea(value: unknown): PracticeAreaCode | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === 'EP' || trimmed === 'EP-LP' || trimmed === 'CP' || trimmed === 'Probate') return trimmed
  const upper = trimmed.toUpperCase()
  if (upper === 'EP') return 'EP'
  if (upper === 'EP-LP') return 'EP-LP'
  if (upper === 'CP') return 'CP'
  if (upper === 'PROBATE') return 'Probate'
  return LEGACY_PRACTICE_AREA_VALUES[trimmed] ?? null
}

export function normalizePracticeArea(value: unknown): PracticeAreaCode {
  return parsePracticeArea(value) ?? 'EP'
}

export function practiceAreaLabel(value: unknown): string {
  const normalized = normalizePracticeArea(value)
  return PRACTICE_AREA_OPTIONS.find(option => option.value === normalized)?.label ?? 'Estate Planning'
}

/** Short code used inside matter numbers, e.g. "EPLP" not "EP-LP". */
export function practiceAreaMatterCode(value: unknown): 'EP' | 'EPLP' | 'CP' | 'PR' {
  const normalized = normalizePracticeArea(value)
  if (normalized === 'EP-LP') return 'EPLP'
  if (normalized === 'CP') return 'CP'
  if (normalized === 'Probate') return 'PR'
  return 'EP'
}

/**
 * The College Preparation Plan: a student turning 18 signing a durable power of
 * attorney, health care proxy, HIPAA authorization, living will, and FERPA
 * release. Its own practice area rather than a flag on an estate matter,
 * because it is a different engagement with a different document set — and it
 * is what the design sheet's plan track follows.
 */
export function isCollegePrepPracticeArea(value: unknown): boolean {
  return normalizePracticeArea(value) === 'CP'
}
