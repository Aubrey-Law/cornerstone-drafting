export type MatterPlanType = 'TBD' | 'Will Plan' | 'Trust Plan' | 'N/A'

export const MATTER_PLAN_TYPE_OPTIONS: Array<{ value: MatterPlanType; label: string }> = [
  { value: 'TBD', label: 'TBD' },
  { value: 'Will Plan', label: 'Will Plan' },
  { value: 'Trust Plan', label: 'Trust Plan' },
  { value: 'N/A', label: 'N/A' },
]

// Legacy values stored before Plan Type was decoupled from Practice Area.
// They render as 'N/A' until Scott confirms historical Will vs Trust
// classification and a backfill migration is run.
const LEGACY_PLAN_TYPES = new Set([
  'Estate Planning',
  'Estate Planning | LP',
  'Estate Planning (LP)',
])

export function normalizePlanType(value: unknown): MatterPlanType {
  if (typeof value !== 'string') return 'N/A'
  const trimmed = value.trim()
  if (trimmed === 'TBD' || trimmed === 'Will Plan' || trimmed === 'Trust Plan' || trimmed === 'N/A') {
    return trimmed
  }
  if (LEGACY_PLAN_TYPES.has(trimmed)) return 'N/A'
  return 'N/A'
}

export function planTypeLabel(value: unknown): string {
  return normalizePlanType(value)
}
