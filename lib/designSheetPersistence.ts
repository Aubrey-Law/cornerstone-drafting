import type { DesignSheet, DesignSheetUpdate } from '@/types/database'
import { toDateInputValue } from '@/lib/dob'
import type { FiduciarySlot } from '@/types/database'
import { formatPhoneFieldsDeep } from '@/lib/phone'
import { repairFiduciarySlotOrdering } from '@/lib/designSheet/fiduciarySlotOrdering'

const SYSTEM_COLUMNS = new Set(['id', 'matter_id', 'client_intake_id', 'created_at', 'updated_at'])
// Owned by the matter, overlaid onto the sheet for the session. Never a design-sheet column or decision.
const TRANSIENT_SHEET_KEYS = new Set(['matter_type'])
const RETIRED_DESIGN_SHEET_KEYS = new Set(['inheritance_structure'])

/**
 * Decision JSONB namespaces that must live under `sheet.decisions` only.
 * Legacy inflate mirrored these onto the sheet top-level; stale copies must not
 * be re-persisted when the UI updates only `decisions` (e.g. trust checkbox).
 */
const DECISION_ONLY_TOP_LEVEL_KEYS = new Set([
  'college_prep',
  'contact_profiles',
  'deed',
  // Dropped column. Listed here so a value still present on an old inflated row is
  // stripped from the sheet rather than folded into the decisions blob.
  'distribution_method',
  'document_inclusions',
  'dpoa_provisions',
  'estate_plan_design',
  'excluded_guardian',
  'extras',
  'excluded_guardians',
  'excluded_person',
  'execution_mechanics',
  'fiduciary_contact_details',
  'fiduciary_display_options',
  'fiduciary_document_inclusions',
  'funding_plan',
  'healthcare_provisions',
  'plan_track',
  'provisions',
  'real_estate_transfer',
  'settlor_facts',
  'staggered_ages',
  'trust_details',
  'trust_planning_type',
  'will_pr_powers',
  'will_provisions',
])

/** Postgres `date` columns — empty / non-ISO strings must become null or the update fails. */
const DATE_DESIGN_SHEET_COLUMNS = new Set([
  'client_dob',
  'spouse_dob',
  'marriage_date',
  'doc_date',
  'signing_date',
  'notary_commission_expiration',
])

// jsonb fields that must always inflate to an array. A few legacy rows have a
// `{}` default stored instead of `[]`, which would crash `.some`/`.map` callers
// (e.g. design-sheet readiness). Coerce any non-array value to an empty array.
const ARRAY_DESIGN_SHEET_FIELDS = new Set([
  'assets',
  'children',
  'specific_bequests',
  'disinheritances',
  'disinherited_children',
  'additional_beneficiaries',
  'trustee_slots',
  'executor_slots',
  'poa_slots',
  'hcp_slots',
  'guardian_slots',
  'temporary_guardian_slots',
  'spouse_trustee_slots',
  'spouse_executor_slots',
  'spouse_poa_slots',
  'spouse_hcp_slots',
  'remote_beneficiary_individuals',
  'remote_beneficiary_charities',
  'residual_beneficiary_individuals',
  'staggered_distributions',
])

/** Fiduciary slot arrays stored as top-level columns — never shadow in decisions jsonb. */
const FIDUCIARY_SLOT_COLUMN_KEYS = new Set([
  'trustee_slots',
  'executor_slots',
  'poa_slots',
  'hcp_slots',
  'guardian_slots',
  'temporary_guardian_slots',
  'spouse_trustee_slots',
  'spouse_executor_slots',
  'spouse_poa_slots',
  'spouse_hcp_slots',
])

function isFiduciarySlotArray(value: unknown): value is Array<{ contact_id?: string | null }> {
  return Array.isArray(value)
}

function fiduciarySlotsHaveAssignment(slots: unknown): boolean {
  if (!isFiduciarySlotArray(slots)) return false
  return slots.some(slot => typeof slot?.contact_id === 'string' && slot.contact_id.length > 0)
}

/** Prefer column slots when they carry assignments; otherwise fall back to decisions. */
function mergeFiduciarySlotColumn(columnValue: unknown, decisionsValue: unknown): unknown {
  if (fiduciarySlotsHaveAssignment(columnValue)) return columnValue
  if (fiduciarySlotsHaveAssignment(decisionsValue)) return decisionsValue
  if (isFiduciarySlotArray(columnValue) && columnValue.length > 0) return columnValue
  if (isFiduciarySlotArray(decisionsValue) && decisionsValue.length > 0) return decisionsValue
  return columnValue ?? decisionsValue ?? []
}

function repairFiduciarySlotCollection(value: unknown): unknown {
  if (!isFiduciarySlotArray(value)) return value
  return repairFiduciarySlotOrdering(value as FiduciarySlot[])
}

function repairFiduciarySlotColumns(target: Record<string, unknown>): Record<string, unknown> {
  const next = { ...target }
  for (const key of FIDUCIARY_SLOT_COLUMN_KEYS) {
    const raw = next[key]
    if (raw === undefined) continue
    next[key] = repairFiduciarySlotCollection(raw)
  }
  return next
}

// Columns added by 20260715000000_lite_design_sheets_intake_columns.sql — intake seed
// must write here (not only into decisions) so isDesignSheetUnseeded and resync work.
const INTAKE_MIRROR_DESIGN_SHEET_COLUMNS = [
  'client_name',
  'client_dob',
  'client_phone',
  'client_email',
  'client_citizenship',
  'client_domicile',
  'street',
  'city',
  'state',
  'zip',
  'county',
  'marital_status',
  'spouse_name',
  'spouse_dob',
  'spouse_phone',
  'spouse_email',
  'spouse_citizenship',
  'marriage_date',
  'trustee_primary',
  'trustee_alt1',
  'executor_primary',
  'executor_alt1',
  'poa_primary',
  'poa_alt1',
  'hcp_primary',
  'hcp_alt1',
  'guardian_primary',
  'guardian_alt1',
  'children',
  'trustee_slots',
  'executor_slots',
  'poa_slots',
  'hcp_slots',
  'guardian_slots',
  'spouse_executor_slots',
  'spouse_poa_slots',
  'spouse_hcp_slots',
  'overrides',
] as const

/**
 * Columns that exist on the Cornerstone Lite `design_sheets` table.
 * Anything else is stored under `decisions` jsonb (see buildDesignSheetPersistencePayload).
 * Do NOT list aubrey-law-app-only columns here — PostgREST rejects unknown columns and
 * the client surfaces "Unable to save design sheet after several attempts".
 */
const WRITABLE_DESIGN_SHEET_COLUMNS = new Set([
  ...INTAKE_MIRROR_DESIGN_SHEET_COLUMNS,
  'version',
  'status',
  'plan_type',
  'real_property_transfer',
  'trust_name',
  'trust_type',
  'restatement',
  'trust_protector',
  'marital_trust_type',
  'marital_trust_remarriage',
  'include_qdot',
  'family_trust_remarriage',
  'common_trust',
  'residuary_beneficiary',
  'residuary_distribution',
  'withdrawal_right',
  'poa_client_co_authority',
  'poa_spouse_co_authority',
  'marital_status_clause',
  'doc_date',
  'ordinal_doc_date',
  'notary_commission',
  'flags',
  'drafting_notes',
  'decisions',
  'fiduciary_slot_states',
  'goals_notes',
  'concerns',
  'assets',
  'is_joint',
  'spouse_trust_name',
  'disinheritances',
  'remote_beneficiary',
  'remote_beneficiary_individuals',
  'remote_beneficiary_charities',
  'residual_beneficiary_individuals',
  'staggered_distributions',
  'distribution_age',
  // Universal additions present on lite
  'client_aka',
  'client_pronouns',
  'spouse_pronouns',
  'former_spouse_name',
  'deceased_spouse_name',
  'signing_date',
  'signing_month',
  'signing_year',
  'signing_county',
  'notary_commission_expiration',
  'specific_bequests',
  'excluded_guardian_flag',
  'excluded_guardian_name',
  // Slot / co-fiduciary columns on lite baseline + intake migrations
  'temporary_guardian_slots',
  'spouse_trustee_slots',
  'trustee_co',
  'trustee_alt1_co',
  'trustee_alt2',
  'executor_co',
  'executor_alt1_co',
  'executor_same_as_trustee',
  'spouse_executor_same_as_trustee',
  'poa_co',
  'poa_same_as_trustee',
  'hcp_co',
  'hcp_alt1_co',
  'guardian_co',
  'guardian_alt1_co',
  'intake_review_flags',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeColumnValue(key: string, value: unknown) {
  if (key === 'trust_protector' && typeof value === 'boolean') {
    return value ? 'yes' : 'no'
  }
  if (key === 'fiduciary_slot_states' && value == null) {
    return {}
  }
  if (DATE_DESIGN_SHEET_COLUMNS.has(key)) {
    if (value == null || value === '') return null
    if (typeof value === 'string') {
      const normalized = toDateInputValue(value)
      return normalized || null
    }
  }
  return value
}

function normalizeTrustProtector(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return value ?? null
  const normalized = value.toLowerCase()
  if (normalized === 'yes' || normalized === 'true') return true
  if (normalized === 'no' || normalized === 'false') return false
  return value
}

/** Remove stale decision mirrors from the sheet top-level (in-memory / session draft). */
export function stripDecisionOnlyTopLevelMirrors<T extends Record<string, unknown>>(sheet: T): T {
  const next = { ...sheet }
  for (const key of DECISION_ONLY_TOP_LEVEL_KEYS) {
    if (key in next && !WRITABLE_DESIGN_SHEET_COLUMNS.has(key)) {
      delete next[key]
    }
  }
  return next
}

export function buildDesignSheetPersistencePayload(data: DesignSheetUpdate) {
  const input = repairFiduciarySlotColumns(formatPhoneFieldsDeep(data) as Record<string, unknown>)
  const payload: Record<string, unknown> = {}
  const callerSuppliedDecisions = input.decisions !== undefined
  // Start from the canonical decisions object. inflateDesignSheetRow mirrors decision
  // keys onto the sheet top-level for convenience; those mirrors go stale when the UI
  // updates only `decisions` (e.g. document_inclusions.trust) and must NOT win here.
  const decisions: Record<string, unknown> = isRecord(input.decisions) ? { ...input.decisions } : {}

  for (const [key, value] of Object.entries(input)) {
    if (SYSTEM_COLUMNS.has(key) || TRANSIENT_SHEET_KEYS.has(key) || key === 'decisions') continue
    if (RETIRED_DESIGN_SHEET_KEYS.has(key)) continue

    if (WRITABLE_DESIGN_SHEET_COLUMNS.has(key)) {
      payload[key] = normalizeColumnValue(key, value)
    } else if (!DECISION_ONLY_TOP_LEVEL_KEYS.has(key)) {
      // Lite-only template fields without a dedicated column land in decisions jsonb.
      // The stale-mirror hazard is confined to the decision namespaces skipped above,
      // so ordinary fields must overwrite their decisions copy — guarding on
      // `!(key in decisions)` froze every one of them at its first saved value.
      decisions[key] = value
    }
  }

  // Writable columns belong on dedicated fields; stale copies in decisions caused reloads
  // to prefer legacy jsonb values (e.g. plan_type, fiduciary slots) over saved columns.
  for (const key of WRITABLE_DESIGN_SHEET_COLUMNS) {
    if (key !== 'decisions') {
      delete decisions[key]
    }
  }
  for (const key of TRANSIENT_SHEET_KEYS) delete decisions[key]

  // Only write the decisions column when the caller actually had something to say
  // about it. Partial patches list columns only (asset intake sync, intake re-sync),
  // and emitting `{}` for those replaced the attorney's entire decision blob —
  // document inclusions, trust details, DPOA/health care provisions — with nothing.
  if (callerSuppliedDecisions || Object.keys(decisions).length > 0) {
    payload.decisions = decisions
  }
  return payload
}

/**
 * Merge a client PATCH onto the stored sheet and build the row payload to write.
 *
 * `incomingDecisions` is the client's authoritative decisions blob and wins over
 * anything the payload builder derived from the stored row — the stored row's
 * top-level values are by definition the pre-edit ones.
 */
export function buildDesignSheetSavePayload(args: {
  existingSheet: DesignSheet | null
  incomingSheet: Record<string, unknown>
  incomingDecisions: Record<string, unknown>
}) {
  const { existingSheet, incomingSheet, incomingDecisions } = args
  const hasIncomingDecisions = Object.keys(incomingDecisions).length > 0
  const existingDecisions = existingSheet && isRecord(existingSheet.decisions)
    ? existingSheet.decisions
    : {}

  const sheetForPersistence = existingSheet
    ? ({
        ...existingSheet,
        ...incomingSheet,
        decisions: hasIncomingDecisions ? incomingDecisions : existingDecisions,
      } as DesignSheetUpdate)
    : ({
        ...incomingSheet,
        decisions: hasIncomingDecisions
          ? incomingDecisions
          : (incomingSheet as DesignSheetUpdate).decisions,
      } as DesignSheetUpdate)

  const payload = buildDesignSheetPersistencePayload(formatPhoneFieldsDeep(sheetForPersistence))

  if (hasIncomingDecisions) {
    const cleanedDecisions = { ...incomingDecisions }
    for (const key of SYSTEM_COLUMNS) delete cleanedDecisions[key]
    for (const key of TRANSIENT_SHEET_KEYS) delete cleanedDecisions[key]
    payload.decisions = {
      ...(isRecord(payload.decisions) ? payload.decisions : {}),
      ...cleanedDecisions,
    }
  }

  return payload
}

export function inflateDesignSheetRow(row: Record<string, unknown> | null): DesignSheet | null {
  if (!row) return null

  let decisions = isRecord(row.decisions) ? row.decisions : {}
  if ([...TRANSIENT_SHEET_KEYS].some(key => key in decisions)) {
    decisions = { ...decisions }
    for (const key of TRANSIENT_SHEET_KEYS) delete decisions[key]
  }
  const sheet = { ...row, decisions } as Record<string, unknown>

  for (const [key, value] of Object.entries(decisions)) {
    if (SYSTEM_COLUMNS.has(key) || TRANSIENT_SHEET_KEYS.has(key) || key === 'decisions') continue
    if (RETIRED_DESIGN_SHEET_KEYS.has(key)) continue

    // Decision namespaces (document_inclusions, estate_plan_design, etc.) must stay
    // nested so stale mirrors cannot overwrite newer decisions. Ordinary template
    // fields without dedicated Lite columns (bond, supervision, DPOA/HCP choices,
    // etc.) are stored in decisions and must be restored to the top-level UI shape.
    if (DECISION_ONLY_TOP_LEVEL_KEYS.has(key)) continue
    if (!WRITABLE_DESIGN_SHEET_COLUMNS.has(key)) {
      sheet[key] = value
      continue
    }

    if (FIDUCIARY_SLOT_COLUMN_KEYS.has(key)) {
      sheet[key] = mergeFiduciarySlotColumn(sheet[key], value)
      continue
    }

    const current = sheet[key]
    const currentEmptyArray = Array.isArray(current) && current.length === 0
    const decisionNonEmptyArray = Array.isArray(value) && value.length > 0
    if (current == null || current === '' || (currentEmptyArray && decisionNonEmptyArray)) {
      sheet[key] = value
    }
  }

  sheet.trust_protector = normalizeTrustProtector(sheet.trust_protector)

  // Normalise array-typed jsonb fields so a malformed `{}` never reaches
  // consumers that call array methods (e.g. design-sheet readiness).
  for (const key of ARRAY_DESIGN_SHEET_FIELDS) {
    if (sheet[key] != null && !Array.isArray(sheet[key])) {
      sheet[key] = []
    }
  }

  const repaired = repairFiduciarySlotColumns(sheet)

  return stripDecisionOnlyTopLevelMirrors(repaired) as unknown as DesignSheet
}
