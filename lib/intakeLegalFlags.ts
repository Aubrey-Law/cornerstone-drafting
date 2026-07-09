import type { IntakeRow } from '@/lib/intakeSections'
import { intakePlanTypeIncludesTrust, normalizeIntakePlanType } from '@/lib/intakePlanType'

/**
 * Substantive, attorney-facing legal flags surfaced live in the Guided Interview
 * (attorney mode). These are distinct from the "missing field" readiness flags
 * in `lib/intakeReadiness.ts` — they are derived from the *choices* made
 * (plan type, citizenship, minor children) rather than from omissions.
 *
 * `tone` drives the panel color: amber = action likely required; blue =
 * confirm/verify. Mirrors the flag logic in the design mock.
 */
export type LegalFlagTone = 'amber' | 'blue'

export interface LegalReviewFlag {
  key: string
  tone: LegalFlagTone
  text: string
}

function text(data: IntakeRow, key: string): string {
  return typeof data[key] === 'string' ? (data[key] as string).trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function firstName(data: IntakeRow): string {
  return text(data, 'first_name') || 'the client'
}

function spouseFirstName(data: IntakeRow): string {
  const spouse = data._spouse
  if (isRecord(spouse) && typeof spouse.first_name === 'string' && spouse.first_name.trim()) {
    return spouse.first_name.trim()
  }
  return text(data, 'spouse_first_name') || 'the spouse'
}

/**
 * `false` means an explicit non-citizen selection. We treat only an explicit
 * `false` as a non-citizen (the column/overlay defaults to citizen/`true`).
 */
function clientIsNonCitizen(data: IntakeRow): boolean {
  return data.is_us_citizen === false
}

function spouseIsNonCitizen(data: IntakeRow): boolean {
  const spouse = data._spouse
  if (isRecord(spouse)) return spouse.is_us_citizen === false
  return data.spouse_is_us_citizen === false
}

/**
 * Compute the live legal-review flags for the attorney panel.
 *
 * @param data    The (unpacked) intake overlay.
 * @param planType The attorney-chosen intake plan type (`client_intake.plan_type`).
 */
export function getLegalReviewFlags(data: IntakeRow, planType: unknown): LegalReviewFlag[] {
  const flags: LegalReviewFlag[] = []
  const married = text(data, 'marital_status') === 'married'
  const includesTrust = intakePlanTypeIncludesTrust(planType)
  const normalizedPlan = normalizeIntakePlanType(planType)

  // QDOT — a non-citizen spouse in a trust plan may require a QDOT to preserve
  // the marital deduction.
  if (includesTrust) {
    if (married && spouseIsNonCitizen(data)) {
      flags.push({
        key: 'qdot_spouse',
        tone: 'amber',
        text: `QDOT may be required — ${spouseFirstName(data)} is a non-citizen spouse.`,
      })
    } else if (clientIsNonCitizen(data)) {
      flags.push({
        key: 'qdot_client',
        tone: 'amber',
        text: `QDOT may be required — ${firstName(data)} is a non-citizen.`,
      })
    }
  }

  // Minor children → guardians; otherwise confirm no SNT need.
  if (data.has_minor_children === true) {
    flags.push({
      key: 'minor_guardians',
      tone: 'amber',
      text: 'Minor children — nominate guardians and a standby guardian.',
    })
  } else if (data.has_children === true) {
    flags.push({
      key: 'no_minors_snt',
      tone: 'blue',
      text: 'No minor children — confirm no beneficiary needs a special-needs trust.',
    })
  }

  // Representation type is a trust-drafting decision worth confirming.
  if (includesTrust) {
    flags.push({
      key: 'representation_type',
      tone: 'blue',
      text: 'Confirm representation type: per stirpes vs. by right of representation.',
    })
  }

  // No-trust plans: confirm probate is acceptable.
  if (normalizedPlan && !includesTrust) {
    flags.push({
      key: 'no_trust',
      tone: 'amber',
      text: 'No trust selected — confirm assets pass appropriately and probate is acceptable.',
    })
  }

  return flags
}
