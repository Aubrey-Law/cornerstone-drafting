/**
 * Field mapping for a manual Cornerstone → Lawmatics prospect push.
 *
 * Standard fields use Lawmatics' own contact attribute names, as its document
 * merge-field reference lists them (first_name, name_suffix, informal_name,
 * street2, zipcode, …). Every other field is a Lawmatics custom field
 * the firm defines, so it is sent only when integration_settings maps its key
 * to a Lawmatics custom field ID; unmapped values are reported, never dropped
 * silently and never guessed.
 */

export type LawmaticsPushFieldKey =
  | 'first_name' | 'last_name' | 'email' | 'phone' | 'birthdate'
  | 'street' | 'city' | 'state' | 'zipcode' | 'marital_status'
  | 'middle_name' | 'suffix' | 'preferred_name' | 'address_line2' | 'county'
  | 'spouse_first_name' | 'spouse_last_name' | 'spouse_email' | 'spouse_phone' | 'spouse_date_of_birth'
  | 'children' | 'lead_source' | 'referral_source' | 'practice_area' | 'plan_type' | 'lead_status'
  | 'estate_value' | 'occupation' | 'employer' | 'citizenship' | 'planning_objectives' | 'special_notes'
  | 'qualification_notes' | 'notes' | 'matter_number'
  | 'preferred_pronoun' | 'date_of_marriage' | 'legal_plan_member_id'

export interface LawmaticsPushField {
  key: LawmaticsPushFieldKey
  label: string
  /** Standard prospect attribute; custom fields go through the configured ID map. */
  standard: boolean
  /** Lawmatics attribute name for a standard field, when it differs from the key. */
  attribute?: string
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
  { key: 'practice_area', label: 'Practice area', standard: false },
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
  spouse: PersonRow | null
  children: PersonRow[]
}

export type LawmaticsProspectBody = Record<string, unknown> & {
  first_name?: string
  last_name?: string
  custom_fields?: { id: string; value: string }[]
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
    practice_area: text(intake.practice_area),
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
): { body: LawmaticsProspectBody; sentKeys: LawmaticsPushFieldKey[]; unmappedKeys: LawmaticsPushFieldKey[] } {
  const values = lawmaticsPushValues(source)
  const body: LawmaticsProspectBody = {}
  const customFields: { id: string; value: string }[] = []
  const sentKeys: LawmaticsPushFieldKey[] = []
  const unmappedKeys: LawmaticsPushFieldKey[] = []
  for (const field of LAWMATICS_PUSH_FIELDS) {
    const value = values[field.key]
    if (value === undefined) continue
    if (field.standard) {
      body[field.attribute ?? field.key] = value
      sentKeys.push(field.key)
      continue
    }
    const id = Object.hasOwn(customFieldIdMap, field.key) ? text(customFieldIdMap[field.key]) : undefined
    if (!id) {
      unmappedKeys.push(field.key)
      continue
    }
    customFields.push({ id, value })
    sentKeys.push(field.key)
  }
  if (customFields.length) body.custom_fields = customFields
  return { body, sentKeys, unmappedKeys }
}
