import type { MatterDetailsRow } from '@/types/matter-details'

/**
 * Whether the plan is drafted for one person or two is a property of the
 * matter, not of the client's marital status: a married client can hire the
 * firm alone, and an unmarried couple can hire it together. `matter_type` is
 * therefore what gates the spouse surfaces, joint trusts and second-death
 * provisions — marital status stays a displayed fact.
 */

export type MatterType = 'individual' | 'couple'

export const MATTER_TYPE_OPTIONS: Array<{ value: MatterType; label: string }> = [
  { value: 'individual', label: 'Individual' },
  { value: 'couple', label: 'Couple' },
]

export function normalizeMatterType(value: unknown): MatterType | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  if (trimmed === 'couple' || trimmed === 'joint') return 'couple'
  if (trimmed === 'individual' || trimmed === 'single') return 'individual'
  return null
}

export function matterTypeLabel(value: unknown): string {
  const normalized = normalizeMatterType(value)
  if (!normalized) return '—'
  return MATTER_TYPE_OPTIONS.find(option => option.value === normalized)?.label ?? normalized
}

/**
 * Legacy matters predate `matter_type`, so an unset value falls back to the
 * married check the page used before rather than silently hiding a spouse
 * the firm has already recorded.
 */
export function isCoupleMatter(
  details: Pick<MatterDetailsRow, 'matter_type'> | null | undefined,
  fallbackMaritalStatus?: string | null,
): boolean {
  const normalized = normalizeMatterType(details?.matter_type)
  if (normalized) return normalized === 'couple'
  return fallbackMaritalStatus?.trim().toLowerCase() === 'married'
}
