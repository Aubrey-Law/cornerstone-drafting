export type DesignPlanType =
  | 'pour_over'
  | 'outright_will'
  | 'testamentary_trust'

export const DESIGN_PLAN_TYPE_OPTIONS: Array<{ value: DesignPlanType; label: string }> = [
  { value: 'pour_over', label: 'Pour-Over Will + Revocable Trust' },
  { value: 'outright_will', label: 'Will — Outright Distributions' },
  { value: 'testamentary_trust', label: 'Will — Testamentary Trust' },
]

const ALL_KNOWN_VALUES: DesignPlanType[] = [
  'pour_over', 'outright_will', 'testamentary_trust',
]

export function normalizeDesignPlanType(value: unknown): DesignPlanType | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (ALL_KNOWN_VALUES.includes(trimmed as DesignPlanType)) return trimmed as DesignPlanType
  return null
}

export function designPlanTypeLabel(value: unknown): string {
  const normalized = normalizeDesignPlanType(value)
  if (!normalized) return typeof value === 'string' ? value : ''
  return DESIGN_PLAN_TYPE_OPTIONS.find(option => option.value === normalized)?.label ?? normalized
}

/** True when the plan includes any trust structure (revocable or testamentary). */
export function designPlanTypeIncludesTrust(value: unknown): boolean {
  const normalized = normalizeDesignPlanType(value)
  return normalized === 'pour_over' || normalized === 'testamentary_trust'
}

/** True only when the plan includes a revocable living trust document. */
export function designPlanTypeIncludesRevocableTrust(value: unknown): boolean {
  return normalizeDesignPlanType(value) === 'pour_over'
}

export function planTypeDisallowsRevocableTrustDocument(value: unknown): boolean {
  return normalizeDesignPlanType(value) === 'testamentary_trust'
}
