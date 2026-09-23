/**
 * Field mapping for a manual Cornerstone → Lawmatics prospect push.
 *
 * Standard fields use Lawmatics' own contact attribute names, as its document
 * merge-field reference lists them (first_name, name_suffix, informal_name,
 * street2, zipcode, …). Every other field is a Lawmatics custom field
 * the firm defines, so it is sent only when integration_settings maps its key
 * to a Lawmatics custom field ID; unmapped values are reported, never dropped
 * silently and never guessed. Lawmatics' Practice Area, Source and Campaign
 * are built-in picklists set by option ID, so those go through a second map
 * from Cornerstone values to Lawmatics option IDs.
 */

import { normalizePracticeArea } from '@/lib/practiceArea'

/** Lawmatics picklists the push sets by option ID (Settings → Lawmatics). */
export const LAWMATICS_OPTION_KINDS = ['practice_area', 'source', 'campaign'] as const
export type LawmaticsOptionKind = typeof LAWMATICS_OPTION_KINDS[number]
export type LawmaticsOptionIdMap = Record<LawmaticsOptionKind, Record<string, string>>

/** Tolerant read: a malformed entry is dropped rather than failing every push. */
export function readLawmaticsOptionIdMap(value: unknown): LawmaticsOptionIdMap {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const result = { practice_area: {}, source: {}, campaign: {} } as LawmaticsOptionIdMap
  for (const kind of LAWMATICS_OPTION_KINDS) {
    const entries = source[kind]
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue
    for (const [key, id] of Object.entries(entries as Record<string, unknown>)) {
      if (!key || ['__proto__', 'constructor', 'prototype'].includes(key)) continue
      if (typeof id === 'string' && /^\d{1,12}$/.test(id.trim())) result[kind][key] = id.trim()
    }
  }
  return result
}


/** Lead sources are free text; the option map keys them case- and space-insensitively. */
export function leadSourceKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const key = value.trim().replace(/\s+/g, ' ').toLowerCase()
  return key && key.length <= 200 ? key : null
}


export type LawmaticsPushFieldKey =
  | 'first_name' | 'last_name' | 'email' | 'phone' | 'birthdate'
  | 'street' | 'city' | 'state' | 'zipcode' | 'marital_status'
  | 'middle_name' | 'suffix' | 'preferred_name' | 'address_line2' | 'county'
  | 'spouse_first_name' | 'spouse_last_name' | 'spouse_email' | 'spouse_phone' | 'spouse_date_of_birth'
  | 'children' | 'lead_source' | 'referral_source' | 'practice_area' | 'plan_type' | 'lead_status'
  | 'estate_value' | 'occupation' | 'employer' | 'citizenship' | 'planning_objectives' | 'special_notes'
  | 'qualification_notes' | 'notes' | 'matter_number'
  | 'preferred_pronoun' | 'date_of_marriage' | 'legal_plan_member_id'
  | 'lawmatics_source' | 'lawmatics_campaign' | 'actual_value'

export interface LawmaticsPushField {
  key: LawmaticsPushFieldKey
  label: string
  /** Standard prospect attribute; custom fields go through the configured ID map. */
  standard: boolean
  /** Lawmatics attribute name for a standard field, when it differs from the key. */
  attribute?: string
  /** A Lawmatics picklist: the value is looked up in the option map and its ID is sent. */
  option?: LawmaticsOptionKind
  /** Sent as a number rather than text. */
  numeric?: boolean
}

export const LAWMATICS_PUSH_FIELDS: readonly LawmaticsPushField[] = [
  { key: 'first_name', label: 'First name', standard: true },
  { key: 'middle_name', label: 'Middle name', standard: true },
  { key: 'last_name', label: 'Last name', standard: true },
  { key: 'suffix', label: 'Suffix', standard: true, attribute: 'name_suffix' },
  { key: 'preferred_name', label: 'Preferred name', standard: true, attribute: 'informal_name' },
  { key: 'email', label: 'Email', standard: true },
  { key: 'phone', label: 'Phone', standard: true },
  { key: 'birthdate', label: 'Date of birth', standard: true },
  { key: 'street', label: 'Street address', standard: true },
  { key: 'address_line2', label: 'Address line 2', standard: true, attribute: 'street2' },
  { key: 'city', label: 'City', standard: true },
  { key: 'state', label: 'State', standard: true },
  { key: 'zipcode', label: 'ZIP', standard: true },
  { key: 'marital_status', label: 'Marital status', standard: true },
  { key: 'occupation', label: 'Occupation', standard: true },
  { key: 'employer', label: 'Employer', standard: true },
  { key: 'citizenship', label: 'Citizenship', standard: true },
  { key: 'matter_number', label: 'Matter number', standard: true, attribute: 'case_number' },
  { key: 'practice_area', label: 'Practice area', standard: true, attribute: 'practice_area_id', option: 'practice_area', numeric: true },
  { key: 'lawmatics_source', label: 'Source', standard: true, attribute: 'source_id', option: 'source', numeric: true },
  { key: 'lawmatics_campaign', label: 'Campaign', standard: true, attribute: 'campaign_id', option: 'campaign', numeric: true },
  { key: 'actual_value', label: 'Actual value', standard: true, numeric: true },
  { key: 'county', label: 'County', standard: false },
  { key: 'preferred_pronoun', label: 'Preferred pronouns', standard: false },
  { key: 'date_of_marriage', label: 'Date of marriage', standard: false },
  { key: 'spouse_first_name', label: 'Spouse first name', standard: false },
  { key: 'spouse_last_name', label: 'Spouse last name', standard: false },
  { key: 'spouse_email', label: 'Spouse email', standard: false },
  { key: 'spouse_phone', label: 'Spouse phone', standard: false },
  { key: 'spouse_date_of_birth', label: 'Spouse date of birth', standard: false },
  { key: 'children', label: 'Children', standard: false },
  { key: 'lead_source', label: 'Lead source', standard: false },
  { key: 'referral_source', label: 'Referral source', standard: false },
  { key: 'plan_type', label: 'Plan type', standard: false },
  { key: 'lead_status', label: 'Lead status', standard: false },
  { key: 'estate_value', label: 'Estate value', standard: false },
  { key: 'legal_plan_member_id', label: 'Legal plan member ID', standard: false },
  { key: 'planning_objectives', label: 'Planning objectives', standard: false },
  { key: 'special_notes', label: 'Special notes', standard: false },
  { key: 'qualification_notes', label: 'Qualification notes', standard: false },
  { key: 'notes', label: 'Internal notes', standard: false },
]

type PersonRow = {
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  date_of_birth: string | null
}

export interface LawmaticsPushSource {
  intake: Record<string, string | null>
  matterNumber: string | null
  /** The hired matter's practice area, which wins over the intake's. */
  matterPracticeArea?: string | null
  /** The matter's flat fee, else the lead's quoted fee. */
  fee?: number | null
  spouse: PersonRow | null
  children: PersonRow[]
}

export type LawmaticsProspectBody = Record<string, unknown> & {
  first_name?: string
  last_name?: string
  custom_fields?: { id: string; value: string }[]
}

/**
 * Lawmatics custom field IDs are numbers. Accepts the bare number or the merge
 * field copied from Lawmatics' document reference ("custom_field_930886" or
 * "{{custom_field_930886}}"); anything else, such as a built-in merge field
 * name like "practice_area", is not a custom field ID.
 */
export function normalizeLawmaticsCustomFieldId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^\s*(?:\{\{\s*)?(?:custom_field_)?(\d{1,12})(?:\s*\}\})?\s*$/i.exec(value)
  return match ? match[1] : null
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

/** Calendar date only: timestamps and malformed values are not sent as a birthdate. */
function calendarDate(value: unknown): string | undefined {
  const source = text(value)
  const match = source && /^(\d{4})-(\d{2})-(\d{2})/.exec(source)
  if (!match) return undefined
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.getUTCDate() === Number(match[3]) && date.getUTCMonth() === Number(match[2]) - 1
    ? `${match[1]}-${match[2]}-${match[3]}` : undefined
}

/** Cornerstone stores keys like `domestic_partner` / `referral`; Lawmatics shows title-cased choices. */
function titleCase(value: unknown): string | undefined {
  const source = text(value)
  if (!source) return undefined
  return source.replace(/[_-]+/g, ' ').toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase())
}

function personName(person: PersonRow): string | undefined {
  return [text(person.first_name), text(person.last_name)].filter(Boolean).join(' ') || undefined
}

export function lawmaticsPushValues(source: LawmaticsPushSource): Partial<Record<LawmaticsPushFieldKey, string>> {
  const intake = source.intake
  const spouse = source.spouse
  const children = source.children.map(personName).filter((name): name is string => Boolean(name))
  const values: Partial<Record<LawmaticsPushFieldKey, string | undefined>> = {
    first_name: text(intake.first_name),
    last_name: text(intake.last_name),
    email: text(intake.email),
    phone: text(intake.phone),
    birthdate: calendarDate(intake.date_of_birth),
    street: text(intake.address_line1),
    city: text(intake.city),
    state: text(intake.state),
    zipcode: text(intake.zip),
    marital_status: titleCase(intake.marital_status),
    middle_name: text(intake.middle_name),
    suffix: text(intake.suffix),
    preferred_name: text(intake.preferred_name),
    address_line2: text(intake.address_line2),
    county: text(intake.county),
    spouse_first_name: text(spouse?.first_name),
    spouse_last_name: text(spouse?.last_name),
    spouse_email: text(spouse?.email),
    spouse_phone: text(spouse?.phone),
    spouse_date_of_birth: calendarDate(spouse?.date_of_birth),
    children: children.length ? children.join(', ') : undefined,
    lead_source: titleCase(intake.lead_source),
    referral_source: text(intake.referral_source),
    practice_area: text(source.matterPracticeArea) || text(intake.practice_area)
      ? normalizePracticeArea(text(source.matterPracticeArea) ?? intake.practice_area) : undefined,
    lawmatics_source: leadSourceKey(intake.lead_source) ?? undefined,
    lawmatics_campaign: leadSourceKey(intake.lead_source) ?? undefined,
    actual_value: typeof source.fee === 'number' && Number.isFinite(source.fee) && source.fee >= 0
      ? String(source.fee) : undefined,
    plan_type: titleCase(intake.plan_type),
    lead_status: titleCase(intake.lead_status),
    estate_value: text(intake.estate_value),
    occupation: text(intake.occupation),
    employer: text(intake.employer),
    citizenship: text(intake.citizenship),
    preferred_pronoun: text(intake.preferred_pronoun),
    date_of_marriage: calendarDate(intake.date_of_marriage) ?? calendarDate(intake.marriage_date),
    legal_plan_member_id: text(intake.legal_plan_member_id),
    planning_objectives: text(intake.planning_objectives),
    special_notes: text(intake.special_notes),
    qualification_notes: text(intake.qualification_notes),
    notes: text(intake.notes),
    matter_number: text(source.matterNumber),
  }
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<Record<LawmaticsPushFieldKey, string>>
}

/**
 * Builds the prospect body. Empty values are omitted rather than sent as null,
 * so a push never blanks a value someone entered directly in Lawmatics.
 */
export function buildLawmaticsProspectBody(
  source: LawmaticsPushSource,
  customFieldIdMap: Record<string, string>,
  optionIdMap: LawmaticsOptionIdMap = { practice_area: {}, source: {}, campaign: {} },
): {
  body: LawmaticsProspectBody
  sentKeys: LawmaticsPushFieldKey[]
  unmappedKeys: LawmaticsPushFieldKey[]
  /** Mapped to something that is not a Lawmatics custom field ID; skipped. */
  invalidMappingKeys: LawmaticsPushFieldKey[]
  /** Lawmatics custom field ID → the push field it carries. */
  customFieldKeys: Record<string, LawmaticsPushFieldKey>
} {
  const values = lawmaticsPushValues(source)
  const body: LawmaticsProspectBody = {}
  const customFields: { id: string; value: string }[] = []
  const sentKeys: LawmaticsPushFieldKey[] = []
  const unmappedKeys: LawmaticsPushFieldKey[] = []
  const invalidMappingKeys: LawmaticsPushFieldKey[] = []
  const customFieldKeys: Record<string, LawmaticsPushFieldKey> = {}
  for (const field of LAWMATICS_PUSH_FIELDS) {
    const value = values[field.key]
    if (value === undefined) continue
    if (field.standard) {
      let sent: string = value
      if (field.option) {
        const optionId = Object.hasOwn(optionIdMap[field.option], value) ? optionIdMap[field.option][value] : undefined
        if (!optionId) {
          unmappedKeys.push(field.key)
          continue
        }
        sent = optionId
      }
      body[field.attribute ?? field.key] = field.numeric ? Number(sent) : sent
      sentKeys.push(field.key)
      continue
    }
    const mapped = Object.hasOwn(customFieldIdMap, field.key) ? text(customFieldIdMap[field.key]) : undefined
    if (!mapped) {
      unmappedKeys.push(field.key)
      continue
    }
    const id = normalizeLawmaticsCustomFieldId(mapped)
    if (!id) {
      invalidMappingKeys.push(field.key)
      continue
    }
    customFields.push({ id, value })
    customFieldKeys[id] = field.key
    sentKeys.push(field.key)
  }
  if (customFields.length) body.custom_fields = customFields
  return { body, sentKeys, unmappedKeys, invalidMappingKeys, customFieldKeys }
}
