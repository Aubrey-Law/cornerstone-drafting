/**
 * Whether the plan is drafted for one person or two is a property of the
 * matter, not of the client's marital status: a married client can hire the
 * firm alone, and an unmarried couple can hire it together. `matter_type` is
 * therefore what gates the spouse surfaces, joint trusts and second-death
 * provisions — marital status stays a displayed fact.
 */

export type MatterType = 'individual' | 'couple'
export type DraftComposition = 'individual' | 'married_individual' | 'married_joint'

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

export interface ResolveDraftCompositionOptions {
  /**
   * The plan is only ever drafted for one client, whatever the matter says —
   * the College Preparation Plan, where parents are contacts and nominees
   * rather than co-clients.
   */
  singleClientPlan?: boolean
}

export function resolveDraftComposition(
  matterType: unknown,
  isJoint: boolean,
  options: ResolveDraftCompositionOptions = {},
): DraftComposition {
  // A plan with no one-or-two decision behind it needs no confirmation of one:
  // blocking on a question with a single possible answer helps nobody, and a
  // `couple` left over from a matter reclassified out of estate planning would
  // put spouse documents into a plan that has no spouse.
  if (options.singleClientPlan) return 'individual'
  const normalized = normalizeMatterType(matterType)
  // Every other plan keeps the guard. Drafting a couple's plan as an
  // individual's, or the reverse, is silent and wrong — the error is the point.
  if (!normalized) throw new Error('Matter type must be confirmed before drafting')
  if (normalized === 'individual') return 'individual'
  return isJoint ? 'married_joint' : 'married_individual'
}

export function isCoupleMatter(matterType: unknown): boolean {
  return normalizeMatterType(matterType) === 'couple'
}
