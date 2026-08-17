import type { DesignSectionSummary } from '@/lib/designSheetReadiness'
import {
  getDesignSheetHealthcareProvisions,
  setDesignSheetHealthcareProvisions,
} from '@/lib/designSheetHealthcareProvisions'
import {
  applyDecisionFieldValues,
  readDecisionFieldRaw,
  type DesignSheetDecisionField,
} from '@/lib/designSheetImport/decisionFields'
import type { DesignSheet, FiduciarySlot } from '@/types/database'

// v2 added the `decisions` map. A stored v1 preset is still a valid preset —
// it just has no decision fields — so it is read rather than discarded.
export const ATTORNEY_PRESET_VERSION = 2 as const
export const ATTORNEY_PRESET_SUPPORTED_VERSIONS = [1, 2] as const

export const ATTORNEY_PRESET_FIELDS = [
  'bond',
  'supervision',
  'utma_age',
  'no_contest_clause',
  'include_disclaimer_article',
  'include_self_proving_affidavit',
  'trustee_structure',
  'cotrustee_decision_standard',
  'beneficiary_structure',
  'simultaneous_death',
] as const satisfies readonly (keyof DesignSheet)[]

export type AttorneyPresetField = (typeof ATTORNEY_PRESET_FIELDS)[number]

/**
 * Provisions a firm answers the same way on most matters, addressed by their
 * `decisions` namespace.
 *
 * Deliberately excluded, and the line is worth stating: anything the client
 * elects rather than the firm habitually drafts. Anatomical gift and advance
 * directive are the client's own choices; residual_beneficiary_method and the
 * substance-abuse and contingent-SNT provisions turn on this family's
 * circumstances. A preset that carried those would quietly answer questions
 * that were never asked.
 */
export const ATTORNEY_PRESET_DECISION_FIELDS = [
  'trust_details.co_trustee_decision',
  'trust_details.trustee_compensation',
  'trust_details.successor_trustee_vacancy',
  'trust_details.representation_type',
  'trust_details.include_no_contest_clause',
  'trust_details.require_mandatory_arbitration',
  'trust_details.prorate_estate_taxes',
  'trust_details.include_creditor_divorce_provisions',
  'trust_details.include_discretionary_distribution_definition',
  'trust_details.include_education_expenses_definition',
  'dpoa_provisions.agent_compensation',
  'dpoa_provisions.coagent_serving',
  'dpoa_provisions.allow_delegation',
  'dpoa_provisions.prohibit_arbitration',
  'dpoa_provisions.power_digital_assets',
  'dpoa_provisions.allow_medical_information_access',
  'healthcare_provisions.hipaa_include_poa',
  'healthcare_provisions.hipaa_include_trustees',
  'healthcare_provisions.hipaa_list_fiduciaries_by_name',
  'will_pr_powers.allow_pay_taxes_debts_expenses',
  'will_pr_powers.allow_manage_digital_assets',
  'will_pr_powers.include_distribution_cash_or_kind',
] as const satisfies readonly DesignSheetDecisionField[]

export type AttorneyPresetDecisionField = (typeof ATTORNEY_PRESET_DECISION_FIELDS)[number]

export interface AttorneyDesignPreset {
  version: number
  fields: Partial<Pick<DesignSheet, AttorneyPresetField>>
  decisions?: Partial<Record<AttorneyPresetDecisionField, unknown>>
}

export interface AttorneyPresetPreviewItem {
  field: AttorneyPresetField | AttorneyPresetDecisionField
  currentValue: unknown
  presetValue: unknown
  conflict: boolean
}

function isBlank(value: unknown): boolean {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0)
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isAttorneyPresetDecisionField(field: string): field is AttorneyPresetDecisionField {
  return (ATTORNEY_PRESET_DECISION_FIELDS as readonly string[]).includes(field)
}

export function buildAttorneyPreset(sheet: DesignSheet): AttorneyDesignPreset {
  const fields: Record<string, unknown> = {}
  for (const field of ATTORNEY_PRESET_FIELDS) {
    const value = sheet[field]
    if (!isBlank(value)) fields[field] = value
  }

  const decisions: Record<string, unknown> = {}
  for (const field of ATTORNEY_PRESET_DECISION_FIELDS) {
    // Raw, not the typed getter: the getter answers with a default for every
    // unset key, which would capture the whole provision set as "the standard"
    // the first time an attorney saved from a sheet they had barely touched.
    const value = readDecisionFieldRaw(sheet, field)
    if (value !== undefined) decisions[field] = value
  }

  return {
    version: ATTORNEY_PRESET_VERSION,
    fields: fields as AttorneyDesignPreset['fields'],
    decisions: decisions as AttorneyDesignPreset['decisions'],
  }
}

export function previewAttorneyPreset(
  sheet: DesignSheet,
  preset: AttorneyDesignPreset,
): AttorneyPresetPreviewItem[] {
  // A v1 preset predates the decisions map but its column fields are still good.
  // Rejecting it outright would silently retire every standard already saved.
  if (!ATTORNEY_PRESET_SUPPORTED_VERSIONS.includes(preset.version as 1 | 2)) return []

  const columnItems = ATTORNEY_PRESET_FIELDS.flatMap(field => {
    const presetValue = preset.fields[field]
    if (presetValue === undefined || valuesEqual(sheet[field], presetValue)) return []
    return [{
      field,
      currentValue: sheet[field],
      presetValue,
      conflict: !isBlank(sheet[field]),
    } as AttorneyPresetPreviewItem]
  })

  const decisionItems = ATTORNEY_PRESET_DECISION_FIELDS.flatMap(field => {
    const presetValue = preset.decisions?.[field]
    const currentValue = readDecisionFieldRaw(sheet, field)
    if (presetValue === undefined || valuesEqual(currentValue, presetValue)) return []
    return [{
      field,
      currentValue,
      // An unset decision field is undefined, not its getter's default, so
      // applying the standard here is a fill rather than a conflict.
      presetValue,
      conflict: currentValue !== undefined,
    } as AttorneyPresetPreviewItem]
  })

  return [...columnItems, ...decisionItems]
}

export function applyAttorneyPreset(
  sheet: DesignSheet,
  preset: AttorneyDesignPreset,
  options: { overwrite?: boolean } = {},
): Partial<DesignSheet> {
  const patch: Record<string, unknown> = {}
  const decisionValues: Record<string, unknown> = {}

  for (const item of previewAttorneyPreset(sheet, preset)) {
    if (item.conflict && !options.overwrite) continue
    if (isAttorneyPresetDecisionField(item.field)) decisionValues[item.field] = item.presetValue
    else patch[item.field] = item.presetValue
  }

  // Decision fields collapse into the single `decisions` key the sheet actually
  // stores, so the caller's field-by-field update path needs no special case.
  if (Object.keys(decisionValues).length > 0) {
    patch.decisions = applyDecisionFieldValues(sheet, decisionValues)
  }

  return patch as Partial<DesignSheet>
}

const STATUS_PRIORITY: Record<DesignSectionSummary['status'], number> = {
  attention: 0,
  none: 1,
  override: 2,
  complete: 3,
}

export function orderFastEntrySections<T extends { id: string }>(
  sections: T[],
  summaries: Record<string, DesignSectionSummary>,
): T[] {
  return sections
    .map((section, index) => ({ section, index }))
    .sort((left, right) => {
      const leftPriority = STATUS_PRIORITY[summaries[left.section.id]?.status ?? 'none']
      const rightPriority = STATUS_PRIORITY[summaries[right.section.id]?.status ?? 'none']
      return leftPriority - rightPriority || left.index - right.index
    })
    .map(item => item.section)
}

export function preserveFastEntrySectionOrder<T extends { id: string }>(
  sections: T[],
  summaries: Record<string, DesignSectionSummary>,
  previousOrder: string[],
): T[] {
  if (previousOrder.length === 0) return orderFastEntrySections(sections, summaries)

  const sectionsById = new Map(sections.map(section => [section.id, section]))
  const existing = previousOrder.flatMap(id => {
    const section = sectionsById.get(id)
    return section ? [section] : []
  })
  const existingIds = new Set(existing.map(section => section.id))
  const added = orderFastEntrySections(
    sections.filter(section => !existingIds.has(section.id)),
    summaries,
  )
  return [...existing, ...added]
}

function cloneSlots(slots: FiduciarySlot[] | null | undefined): FiduciarySlot[] {
  return (slots ?? []).map(slot => ({ ...slot }))
}

const CLIENT_PRIMARY_CONTACT_ID = '__design_sheet_client__'

function clientPrimaryWithBackups(slots: FiduciarySlot[] | null | undefined): FiduciarySlot[] {
  const source = slots ?? []
  return [
    {
      id: source[0]?.id ?? crypto.randomUUID(),
      contact_id: CLIENT_PRIMARY_CONTACT_ID,
      is_co: false,
      order: 0,
    },
    ...source.slice(1).map((slot, index) => ({ ...slot, order: index + 1 })),
  ]
}

export function buildCopyClientToSpousePatch(sheet: DesignSheet): Partial<DesignSheet> {
  const healthcare = getDesignSheetHealthcareProvisions(sheet)
  return {
    spouse_trustee_slots: clientPrimaryWithBackups(sheet.trustee_slots),
    spouse_executor_slots: clientPrimaryWithBackups(sheet.executor_slots),
    spouse_poa_slots: clientPrimaryWithBackups(sheet.poa_slots),
    spouse_hcp_slots: clientPrimaryWithBackups(sheet.hcp_slots),
    decisions: setDesignSheetHealthcareProvisions(sheet, {
      spouse_anatomical_gift: healthcare.client_anatomical_gift,
      spouse_advance_directive: healthcare.client_advance_directive,
      spouse_hipaa_additional_agent_contact_ids: [...healthcare.client_hipaa_additional_agent_contact_ids],
    }),
  }
}

export function buildTrusteesToPrimaryRolesPatch(
  sheet: DesignSheet,
  inclusions: { will: boolean; dpoa: boolean; healthcare: boolean },
): Partial<DesignSheet> {
  const patch: Partial<DesignSheet> = {}
  if (inclusions.will) patch.executor_slots = cloneSlots(sheet.trustee_slots)
  if (inclusions.dpoa) patch.poa_slots = cloneSlots(sheet.trustee_slots)
  if (inclusions.healthcare) patch.hcp_slots = cloneSlots(sheet.trustee_slots)
  return patch
}
