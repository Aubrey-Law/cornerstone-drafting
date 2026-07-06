import type { IntakeSnapshot } from '@/lib/queries'
import type { DesignSheet, DesignSheetChild, DesignSheetUpdate } from '@/types/database'
import { formatPhoneDisplay } from '@/lib/phone'
import { normalizeOverrideValue } from '@/lib/designSheet/buildInitialSheet'
import { formatDesignSheetImportValue } from '@/lib/designSheetImport/shared'

export const INTAKE_SEED_FIELD_META = {
  client_name: { label: 'Client name', section: 'Personal' },
  client_dob: { label: 'Client date of birth', section: 'Personal' },
  client_phone: { label: 'Client phone', section: 'Personal' },
  client_email: { label: 'Client email', section: 'Personal' },
  client_pronouns: { label: 'Client pronouns', section: 'Personal' },
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
  marriage_date: { label: 'Marriage date', section: 'Family' },
  children: { label: 'Children', section: 'Family' },
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

function intakeChildren(intake: IntakeSnapshot): DesignSheetChild[] | null {
  const children = intake.children?.map(child => ({
    name: child.name,
    dob: child.date_of_birth,
    relationship: child.relationship as DesignSheetChild['relationship'],
    is_minor: false,
  })) ?? []

  return children.length > 0 ? children : null
}

/** Build the design-sheet patch that mirrors the current client intake snapshot. */
export function buildIntakeSeedPayload(intake: IntakeSnapshot): IntakeSeedPayload {
  return {
    client_name: fullName([intake.first_name, intake.middle_name, intake.last_name, intake.suffix]),
    client_dob: intake.date_of_birth,
    client_phone: formatPhoneDisplay(intake.phone),
    client_email: intake.email,
    client_pronouns: intake.preferred_pronoun,
    marital_status: intake.marital_status,
    street: intake.address_line1,
    city: intake.city,
    state: intake.state,
    zip: intake.zip,
    county: intake.county,
    spouse_name: fullName([intake.spouse_first_name, intake.spouse_middle_name, intake.spouse_last_name]),
    spouse_dob: intake.spouse_date_of_birth,
    spouse_phone: formatPhoneDisplay(intake.spouse_phone),
    spouse_email: intake.spouse_email,
    spouse_pronouns: intake.spouse_preferred_pronoun,
    marriage_date: intake.date_of_marriage,
    children: intakeChildren(intake),
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
  }
}

export function isDesignSheetUnseeded(sheet: { client_name?: string | null } | null | undefined): boolean {
  return !sheet?.client_name?.trim()
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
