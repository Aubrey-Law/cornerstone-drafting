export type PracticeAreaCode = 'EP' | 'EP-LP' | 'Probate'

export const PRACTICE_AREA_OPTIONS: { value: PracticeAreaCode; label: string }[] = [
  { value: 'EP', label: 'Estate Planning' },
  { value: 'EP-LP', label: 'Estate Planning - LP' },
  { value: 'Probate', label: 'Probate' },
]

const LEGACY_PRACTICE_AREA_VALUES: Record<string, PracticeAreaCode> = {
  'Estate Planning': 'EP',
  'Estate Planning (LP)': 'EP-LP',
  'Estate Planning | LP': 'EP-LP',
  'Estate Planning - LP': 'EP-LP',
  'Estate Planning-LP': 'EP-LP',
  Probate: 'Probate',
  'Probate (LP)': 'Probate',
  PROBATE: 'Probate',
}

export function parsePracticeArea(value: unknown): PracticeAreaCode | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === 'EP' || trimmed === 'EP-LP' || trimmed === 'Probate') return trimmed
  const upper = trimmed.toUpperCase()
  if (upper === 'EP') return 'EP'
  if (upper === 'EP-LP') return 'EP-LP'
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
export function practiceAreaMatterCode(value: unknown): 'EP' | 'EPLP' | 'PR' {
  const normalized = normalizePracticeArea(value)
  if (normalized === 'EP-LP') return 'EPLP'
  if (normalized === 'Probate') return 'PR'
  return 'EP'
}
