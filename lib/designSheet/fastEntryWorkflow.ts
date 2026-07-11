import type { DesignSectionSummary } from '@/lib/designSheetReadiness'
import {
  getDesignSheetHealthcareProvisions,
  setDesignSheetHealthcareProvisions,
} from '@/lib/designSheetHealthcareProvisions'
import type { DesignSheet, FiduciarySlot } from '@/types/database'

export const ATTORNEY_PRESET_VERSION = 1 as const

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

export interface AttorneyDesignPreset {
  version: typeof ATTORNEY_PRESET_VERSION
  fields: Partial<Pick<DesignSheet, AttorneyPresetField>>
}

export interface AttorneyPresetPreviewItem {
  field: AttorneyPresetField
  currentValue: DesignSheet[AttorneyPresetField]
  presetValue: DesignSheet[AttorneyPresetField]
  conflict: boolean
}

function isBlank(value: unknown): boolean {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0)
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function buildAttorneyPreset(sheet: DesignSheet): AttorneyDesignPreset {
  const fields: Record<string, unknown> = {}
  for (const field of ATTORNEY_PRESET_FIELDS) {
    const value = sheet[field]
    if (!isBlank(value)) fields[field] = value
  }
  return { version: ATTORNEY_PRESET_VERSION, fields: fields as AttorneyDesignPreset['fields'] }
}

export function previewAttorneyPreset(
  sheet: DesignSheet,
  preset: AttorneyDesignPreset,
): AttorneyPresetPreviewItem[] {
  if (preset.version !== ATTORNEY_PRESET_VERSION) return []
  return ATTORNEY_PRESET_FIELDS.flatMap(field => {
    const presetValue = preset.fields[field]
    if (presetValue === undefined || valuesEqual(sheet[field], presetValue)) return []
    return [{
      field,
      currentValue: sheet[field],
      presetValue,
      conflict: !isBlank(sheet[field]),
    } as AttorneyPresetPreviewItem]
  })
}

export function applyAttorneyPreset(
  sheet: DesignSheet,
  preset: AttorneyDesignPreset,
  options: { overwrite?: boolean } = {},
): Partial<DesignSheet> {
  const patch: Record<string, unknown> = {}
  for (const item of previewAttorneyPreset(sheet, preset)) {
    if (!item.conflict || options.overwrite) patch[item.field] = item.presetValue
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
