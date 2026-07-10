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
}

export function normalizePracticeArea(value: unknown): PracticeAreaCode {
  if (typeof value !== 'string') return 'EP'
  const trimmed = value.trim()
  if (trimmed === 'EP' || trimmed === 'EP-LP' || trimmed === 'Probate') return trimmed
  return LEGACY_PRACTICE_AREA_VALUES[trimmed] ?? 'EP'
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
