import type { IntakeSnapshot } from '@/lib/queries'
import type { DesignSheet, DesignSheetChild, DesignSheetUpdate, FiduciarySlot } from '@/types/database'
import { formatPhoneDisplay } from '@/lib/phone'
import { intakePlanTypeMapping } from '@/lib/intakePlanType'
import { normalizeOverrideValue } from '@/lib/designSheet/buildInitialSheet'
import { formatDesignSheetImportValue } from '@/lib/designSheetImport/shared'
import {
  syncConcernsFromIntake,
  syncFieldToDesign,
  syncGoalsNotesFromIntake,
} from '@/lib/sharedFields'

export const INTAKE_SEED_FIELD_META = {
  plan_type: { label: 'Plan type', section: 'Plan' },
  is_joint: { label: 'Joint trust', section: 'Plan' },
  client_name: { label: 'Client name', section: 'Personal' },
  client_dob: { label: 'Client date of birth', section: 'Personal' },
  client_phone: { label: 'Client phone', section: 'Personal' },
  client_email: { label: 'Client email', section: 'Personal' },
  client_pronouns: { label: 'Client pronouns', section: 'Personal' },
  client_aka: { label: 'Client also known as', section: 'Personal' },
  client_citizenship: { label: 'Client citizenship', section: 'Personal' },
  client_domicile: { label: 'State of domicile', section: 'Personal' },
  marital_status: { label: 'Marital status', section: 'Personal' },
  street: { label: 'Street', section: 'Personal' },
  city: { label: 'City', section: 'Personal' },
  state: { label: 'State', section: 'Personal' },
  zip: { label: 'ZIP', section: 'Personal' },
  county: { label: 'County', section: 'Personal' },
  spouse_name: { label: 'Spouse name', section: 'Family' },
  spouse_dob: { label: 'Spouse date of birth', section: 'Family' },
  spouse_phone: { label: 'Spouse phone', section: 'Family' },
  spouse_email: { label: 'Spouse email', section: 'Family' },
  spouse_pronouns: { label: 'Spouse pronouns', section: 'Family' },
  spouse_aka: { label: 'Spouse also known as', section: 'Family' },
  spouse_citizenship: { label: 'Spouse citizenship', section: 'Family' },
  marriage_date: { label: 'Marriage date', section: 'Family' },
  children: { label: 'Children', section: 'Family' },
  goals_notes: { label: 'Client goals', section: 'Goals' },
  concerns: { label: 'Client concerns', section: 'Goals' },
  excluded_guardian_flag: { label: 'Excluded guardian flag', section: 'Fiduciaries' },
  excluded_guardian_name: { label: 'Excluded guardian', section: 'Fiduciaries' },
  trustee_primary: { label: 'Trustee primary', section: 'Fiduciaries' },
  trustee_alt1: { label: 'Trustee alternate', section: 'Fiduciaries' },
  executor_primary: { label: 'Personal representative primary', section: 'Fiduciaries' },
  executor_alt1: { label: 'Personal representative alternate', section: 'Fiduciaries' },
  poa_primary: { label: 'DPOA primary', section: 'Fiduciaries' },
  poa_alt1: { label: 'DPOA alternate', section: 'Fiduciaries' },
  hcp_primary: { label: 'Health care proxy primary', section: 'Fiduciaries' },
  hcp_alt1: { label: 'Health care proxy alternate', section: 'Fiduciaries' },
  guardian_primary: { label: 'Guardian primary', section: 'Fiduciaries' },
  guardian_alt1: { label: 'Guardian alternate', section: 'Fiduciaries' },
  trustee_slots: { label: 'Trustee slots', section: 'Fiduciaries' },
  executor_slots: { label: 'Personal representative slots', section: 'Fiduciaries' },
  poa_slots: { label: 'DPOA slots', section: 'Fiduciaries' },
  hcp_slots: { label: 'Health care proxy slots', section: 'Fiduciaries' },
  guardian_slots: { label: 'Guardian slots', section: 'Fiduciaries' },
  spouse_executor_slots: { label: 'Spouse personal representative slots', section: 'Fiduciaries' },
  spouse_poa_slots: { label: 'Spouse DPOA slots', section: 'Fiduciaries' },
  spouse_hcp_slots: { label: 'Spouse health care proxy slots', section: 'Fiduciaries' },
} as const

export type IntakeSeedField = keyof typeof INTAKE_SEED_FIELD_META
export type IntakeSeedPayload = Partial<Pick<DesignSheetUpdate, IntakeSeedField>>

export interface IntakeResyncPreviewRow {
  field: IntakeSeedField
  label: string
  section: string
  currentValue: unknown
  proposedValue: unknown
  currentDisplay: string
  proposedDisplay: string
  selected: boolean
  replacement: boolean
  blocked: boolean
}

function isEmptyValue(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (typeof value === 'boolean') return false
  if (Array.isArray(value)) return value.length === 0
  return false
}

function stableStringify(value: unknown): string {
  return normalizeOverrideValue(value)
}

function fullName(parts: Array<string | null | undefined>): string | null {
  const name = parts.filter((part): part is string => Boolean(part?.trim())).join(' ').trim()
  return name || null
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed || null
}

function intakeRecord(intake: IntakeSnapshot): Record<string, unknown> {
  const record: Record<string, unknown> = {
    ...intake,
    planning_goals: intake.planning_goals,
    special_notes: intake.special_notes,
  }
  if (typeof intake.planning_objectives === 'string' && intake.planning_objectives.trim().startsWith('{')) {
    try {
      record.planning_objectives = JSON.parse(intake.planning_objectives)
    } catch {
      /* keep string */
    }
  }
  return record
}

function intakeChildren(intake: IntakeSnapshot): DesignSheetChild[] | null {
  const children = intake.children ?? []
  return children.length > 0 ? children : null
}

function fiduciarySlots(slots: FiduciarySlot[] | null | undefined): FiduciarySlot[] | undefined {
  if (!slots?.length) return undefined
  return slots
}

/** Build the design-sheet patch that mirrors the current client intake snapshot. */
export function buildIntakeSeedPayload(intake: IntakeSnapshot): IntakeSeedPayload {
  const record = intakeRecord(intake)
  const excludedName = trimOrNull(intake.excluded_guardian)
  // Attorney plan-structure choice → drafting vocabulary. This is the mapping
  // client_intake.plan_type was always meant to seed through (intakePlanType).
  const planMapping = intakePlanTypeMapping(intake.plan_type)

  return {
    plan_type: planMapping?.designPlanType ?? null,
    is_joint: planMapping ? planMapping.isJoint : null,
    client_name: fullName([intake.first_name, intake.middle_name, intake.last_name, intake.suffix]),
    client_dob: intake.date_of_birth,
    client_phone: formatPhoneDisplay(intake.phone),
    client_email: intake.email,
    client_pronouns: intake.preferred_pronoun,
    client_aka: trimOrNull(intake.prior_names),
    client_citizenship: syncFieldToDesign('client_citizenship', intake.is_us_citizen),
    client_domicile: syncFieldToDesign('client_domicile', intake.state),
    marital_status: syncFieldToDesign('marital_status', intake.marital_status),
    street: intake.address_line1,
    city: intake.city,
    state: intake.state,
    zip: intake.zip,
    county: syncFieldToDesign('county', intake.county),
    spouse_name: fullName([intake.spouse_first_name, intake.spouse_middle_name, intake.spouse_last_name]),
    spouse_dob: intake.spouse_date_of_birth,
    spouse_phone: formatPhoneDisplay(intake.spouse_phone),
    spouse_email: intake.spouse_email,
    spouse_pronouns: intake.spouse_preferred_pronoun,
    spouse_aka: trimOrNull(intake.spouse_prior_names),
    spouse_citizenship: syncFieldToDesign('spouse_citizenship', intake.spouse_is_us_citizen),
    marriage_date: intake.date_of_marriage,
    children: intakeChildren(intake),
    goals_notes: syncGoalsNotesFromIntake(record) ?? null,
    concerns: syncConcernsFromIntake(record) ?? null,
    excluded_guardian_flag: excludedName ? true : null,
    excluded_guardian_name: excludedName,
    trustee_primary: intake.trustee_primary,
    trustee_alt1: intake.trustee_alternate,
    executor_primary: intake.executor_primary,
    executor_alt1: intake.executor_alternate,
    poa_primary: intake.poa_primary,
    poa_alt1: intake.poa_alternate,
    hcp_primary: intake.hcp_primary,
    hcp_alt1: intake.hcp_alternate,
    guardian_primary: intake.guardian_primary,
    guardian_alt1: intake.guardian_alternate,
    trustee_slots: fiduciarySlots(intake.trustee_slots),
    executor_slots: fiduciarySlots(intake.executor_slots),
    poa_slots: fiduciarySlots(intake.poa_slots),
    hcp_slots: fiduciarySlots(intake.hcp_slots),
    guardian_slots: fiduciarySlots(intake.guardian_slots),
    spouse_executor_slots: fiduciarySlots(intake.spouse_executor_slots),
    spouse_poa_slots: fiduciarySlots(intake.spouse_poa_slots),
    spouse_hcp_slots: fiduciarySlots(intake.spouse_hcp_slots),
  }
}

export function isDesignSheetUnseeded(sheet: { client_name?: string | null } | null | undefined): boolean {
  return !sheet?.client_name?.trim()
}

/**
 * Decisions patch for the one-time seed: document toggles implied by the
 * intake plan-structure choice, overlaid with any explicit attorney toggles
 * stored on `client_intake.document_inclusions`. Returns undefined when the
 * intake carries no plan choice, so a plain client intake never disturbs the
 * sheet's decisions.
 */
export function buildIntakeSeedDecisions(
  intake: IntakeSnapshot,
  currentDecisions: DesignSheet['decisions'] | null | undefined,
): Record<string, unknown> | undefined {
  const planMapping = intakePlanTypeMapping(intake.plan_type)
  const seeded: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(planMapping?.documentInclusions ?? {})) {
    if (typeof value === 'boolean') seeded[key] = value
  }
  for (const [key, value] of Object.entries(intake.document_inclusions ?? {})) {
    if (typeof value === 'boolean') seeded[key] = value
  }
  if (Object.keys(seeded).length === 0) return undefined

  const base = currentDecisions && typeof currentDecisions === 'object' && !Array.isArray(currentDecisions)
    ? (currentDecisions as Record<string, unknown>)
    : {}
  const currentInclusions = base.document_inclusions && typeof base.document_inclusions === 'object' && !Array.isArray(base.document_inclusions)
    ? (base.document_inclusions as Record<string, unknown>)
    : {}

  return {
    ...base,
    document_inclusions: { ...currentInclusions, ...seeded },
  }
}

export function buildIntakeResyncPreview(args: {
  currentSheet: Record<string, unknown> | null
  intake: IntakeSnapshot
}): IntakeResyncPreviewRow[] {
  const currentSheet = args.currentSheet ?? {}
  const proposed = buildIntakeSeedPayload(args.intake)
  const overrides = (currentSheet.overrides ?? {}) as Record<string, { original: string }>

  return (Object.keys(INTAKE_SEED_FIELD_META) as IntakeSeedField[]).flatMap(field => {
    const proposedValue = proposed[field]
    if (isEmptyValue(proposedValue)) return []

    const meta = INTAKE_SEED_FIELD_META[field]
    const currentValue = currentSheet[field]
    const blocked = Boolean(overrides[field])
    const replacement = !isEmptyValue(currentValue)
    const differs = stableStringify(currentValue) !== stableStringify(proposedValue)

    if (!differs) return []

    return [{
      field,
      label: meta.label,
      section: meta.section,
      currentValue,
      proposedValue,
      currentDisplay: formatDesignSheetImportValue(currentValue),
      proposedDisplay: formatDesignSheetImportValue(proposedValue),
      selected: !blocked && (!replacement || differs),
      replacement,
      blocked,
    }]
  })
}

export function buildIntakeResyncPatch(args: {
  currentSheet: Pick<DesignSheet, 'overrides'>
  intake: IntakeSnapshot
  fields: IntakeSeedField[]
}): IntakeSeedPayload & { overrides?: DesignSheet['overrides'] } {
  const proposed = buildIntakeSeedPayload(args.intake)
  const patch: IntakeSeedPayload & { overrides?: DesignSheet['overrides'] } = {}
  const overrides = { ...(args.currentSheet.overrides ?? {}) }

  for (const field of args.fields) {
    const value = proposed[field]
    if (value === undefined) continue
    ;(patch as Record<string, unknown>)[field] = value
    delete overrides[field]
  }

  patch.overrides = Object.keys(overrides).length > 0 ? overrides : null
  return patch
}
