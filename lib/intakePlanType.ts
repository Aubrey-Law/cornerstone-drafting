import type { DesignPlanType } from '@/lib/designPlanType'
import type {
  DesignDocumentInclusions,
  TrustPlanningType,
} from '@/lib/designSheetDocumentInclusions'

/**
 * Attorney-facing plan-structure choice surfaced in the Guided Interview.
 * This is the *intake-time* vocabulary (five options matching the design mock).
 * It is deliberately distinct from {@link DesignPlanType} (the 3-value drafting
 * enum) and from `MatterPlanType`; `intakePlanTypeMapping` is the single source
 * of truth that translates an intake choice into the design-sheet fields
 * (`plan_type`, `is_joint`, `trust_planning_type`, `document_inclusions`).
 *
 * Stored on the (previously dormant) free-text `client_intake.plan_type` column.
 */
export type IntakePlanType =
  | 'joint_rlt'
  | 'separate_rlt'
  | 'individual_rlt'
  | 'will_based'
  | 'incapacity_only'

export interface IntakePlanTypeOption {
  value: IntakePlanType
  /** Short title shown on the option card. */
  title: string
  /** One-line description shown under the title. */
  sub: string
  /** Whether this structure implies two settlors by default. */
  twoSettlors: boolean
}

export const INTAKE_PLAN_TYPE_OPTIONS: IntakePlanTypeOption[] = [
  {
    value: 'joint_rlt',
    title: 'Joint Revocable Living Trust',
    sub: 'One trust you both control. Simplest for shared assets and avoiding probate.',
    twoSettlors: true,
  },
  {
    value: 'separate_rlt',
    title: 'Reciprocal / Separate Trusts',
    sub: 'Two mirror-image trusts. Useful for blended families or separate property.',
    twoSettlors: true,
  },
  {
    value: 'individual_rlt',
    title: 'Individual Revocable Living Trust',
    sub: 'A single trust in one name.',
    twoSettlors: false,
  },
  {
    value: 'will_based',
    title: 'Will-Based Plan',
    sub: 'A simpler plan with no trust.',
    twoSettlors: true,
  },
  {
    value: 'incapacity_only',
    title: 'Incapacity-Only Package',
    sub: 'Powers of attorney & health directives only.',
    twoSettlors: true,
  },
]

const ALL_KNOWN_VALUES: IntakePlanType[] = INTAKE_PLAN_TYPE_OPTIONS.map((o) => o.value)

export function normalizeIntakePlanType(value: unknown): IntakePlanType | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return ALL_KNOWN_VALUES.includes(trimmed as IntakePlanType)
    ? (trimmed as IntakePlanType)
    : null
}

export function intakePlanTypeLabel(value: unknown): string {
  const normalized = normalizeIntakePlanType(value)
  if (!normalized) return typeof value === 'string' ? value : ''
  return INTAKE_PLAN_TYPE_OPTIONS.find((o) => o.value === normalized)?.title ?? normalized
}

export function intakePlanTypeIncludesTrust(value: unknown): boolean {
  const normalized = normalizeIntakePlanType(value)
  return (
    normalized === 'joint_rlt' ||
    normalized === 'separate_rlt' ||
    normalized === 'individual_rlt'
  )
}

export interface IntakePlanTypeMapping {
  /**
   * Closest drafting-facing plan type. `null` for incapacity-only, which has no
   * clean {@link DesignPlanType} representation — the document_inclusions below
   * (trust + will both off) carry the meaning instead.
   */
  designPlanType: DesignPlanType | null
  isJoint: boolean
  trustPlanningType: TrustPlanningType
  /**
   * Document defaults this structure implies. Only the keys this mapping is
   * opinionated about are set; the rest fall through to
   * `defaultDocumentInclusions`. `spouse_docs` is intentionally omitted because
   * it is driven by marital status, not plan structure.
   */
  documentInclusions: Partial<DesignDocumentInclusions>
}

/**
 * Translate an intake plan-type choice into the design-sheet fields the drafting
 * flow understands. This is the load-bearing mapping the intake→design-sheet
 * seed relies on (see `buildIntakeSeedPayload` / `buildIntakeSeedDecisions` in
 * lib/designSheet/seedFromIntake.ts).
 */
export function intakePlanTypeMapping(value: unknown): IntakePlanTypeMapping | null {
  const normalized = normalizeIntakePlanType(value)
  if (!normalized) return null

  switch (normalized) {
    case 'joint_rlt':
      return {
        designPlanType: 'pour_over',
        isJoint: true,
        trustPlanningType: 'standard',
        documentInclusions: { trust: true, will: true, dpoa: true, healthcare: true },
      }
    case 'separate_rlt':
      return {
        designPlanType: 'pour_over',
        isJoint: false,
        trustPlanningType: 'standard',
        documentInclusions: { trust: true, will: true, dpoa: true, healthcare: true },
      }
    case 'individual_rlt':
      return {
        designPlanType: 'pour_over',
        isJoint: false,
        trustPlanningType: 'standard',
        documentInclusions: { trust: true, will: true, dpoa: true, healthcare: true },
      }
    case 'will_based':
      return {
        designPlanType: 'outright_will',
        isJoint: false,
        trustPlanningType: 'standard',
        documentInclusions: { trust: false, will: true, dpoa: true, healthcare: true },
      }
    case 'incapacity_only':
      return {
        designPlanType: null,
        isJoint: false,
        trustPlanningType: 'standard',
        documentInclusions: { trust: false, will: false, dpoa: true, healthcare: true },
      }
  }
}
