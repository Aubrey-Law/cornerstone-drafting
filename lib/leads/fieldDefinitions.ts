/**
 * Lead field metadata shared by the field rail, the readiness dial and the Plan
 * tab. The definitions used to live inside `LeadDetailsCard`; they were lifted
 * here so scoring helpers can reuse the same `complete()` predicates instead of
 * restating them.
 */
import { LEGAL_PLAN_OPTIONS, legalPlanDisplayName } from '@/lib/billing/billingType'
import { MARITAL_STATUS_OPTIONS, maritalStatusLabel } from '@/lib/sharedFields'
import { parsePracticeArea, PRACTICE_AREA_OPTIONS, practiceAreaLabel } from '@/lib/practiceArea'
import type { LeadEditableField } from '@/lib/leads/details'
import type { LeadDetailRecord, LeadSpouseRecord } from '@/lib/leads/viewTypes'

export type LeadFieldInput =
  | 'text' | 'email' | 'date' | 'number' | 'select' | 'textarea' | 'address' | 'spouse'

export type LeadFieldDefinition = {
  key: LeadEditableField
  label: string
  missingLabel: string
  complete: (lead: LeadDetailRecord, spouse: LeadSpouseRecord | null) => boolean
  display: (lead: LeadDetailRecord, spouse: LeadSpouseRecord | null) => string | null
  input: LeadFieldInput
  options?: readonly { value: string; label: string }[]
  /**
   * Whether the field is relevant to this lead at all. An inapplicable field is
   * hidden from the rail and left out of readiness entirely — not counted as
   * missing — so a plain EP lead is never scored against plan-only questions.
   * Absent means always applicable.
   */
  applies?: (lead: LeadDetailRecord) => boolean
}

/** Plan billing only exists on the LP track. */
const isLegalPlanLead = (lead: LeadDetailRecord) =>
  parsePracticeArea(lead.practice_area) === 'EP-LP'

export type LeadAddressDraft = {
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  zip: string
  county: string
}

export type LeadSpouseDraft = {
  firstName: string
  middleName: string
  lastName: string
  preferredName: string
  email: string
  phone: string
  dateOfBirth: string
}

export const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

export const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

export const money = (value: number | null | undefined) =>
  value == null ? null : `$${Number(value).toLocaleString()}`

export const joined = (values: unknown[], separator = ' ') => {
  const text = values.filter(hasText).map(value => value.trim()).join(separator)
  return text || null
}

// The shared registry's vocabulary (packages/estate-fields) — the intake
// portal writes all six values, so a narrower local list rendered
// separated/domestic-partner leads blank and silently rewrote them on edit.
export const MARITAL_OPTIONS = MARITAL_STATUS_OPTIONS

export const URGENCY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
] as const

export const MINOR_CHILDREN_OPTIONS = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
] as const

/**
 * `optional` marks a name part the rail keeps out of sight while it is blank.
 * A middle name and a preferred name are absent far more often than they are
 * present, and two permanent "+ Add" chips per lead made the identity row read
 * as unfinished on records that were complete.
 */
export const NAME_COMPONENTS = [
  { key: 'firstName', label: 'First name', property: 'first_name' },
  { key: 'middleName', label: 'Middle name', property: 'middle_name', optional: true },
  { key: 'lastName', label: 'Last name', property: 'last_name' },
  { key: 'preferredName', label: 'Preferred name', property: 'preferred_name', optional: true },
] as const satisfies readonly {
  key: LeadEditableField
  label: string
  property: keyof LeadDetailRecord
  optional?: boolean
}[]

export type LeadNameField = typeof NAME_COMPONENTS[number]['key']

export const FIELD_DEFINITIONS: readonly LeadFieldDefinition[] = [
  {
    key: 'firstName',
    label: 'Name',
    missingLabel: 'Name',
    complete: lead => hasText(lead.first_name) && hasText(lead.last_name),
    display: lead => joined([lead.first_name, lead.middle_name, lead.last_name]),
    input: 'text',
  },
  {
    key: 'email',
    label: 'Email',
    missingLabel: 'Email',
    complete: lead => hasText(lead.email),
    display: lead => hasText(lead.email) ? lead.email : null,
    input: 'email',
  },
  {
    key: 'phone',
    label: 'Phone',
    missingLabel: 'Phone',
    complete: lead => hasText(lead.phone),
    display: lead => hasText(lead.phone) ? lead.phone : null,
    input: 'text',
  },
  {
    key: 'address',
    label: 'Address',
    missingLabel: 'Address',
    complete: lead => (
      hasText(lead.address_line1)
      && hasText(lead.city)
      && hasText(lead.state)
      && hasText(lead.zip)
    ),
    display: lead => joined([
      joined([lead.address_line1, lead.address_line2], ', '),
      lead.city,
      lead.state,
      lead.zip,
      lead.county,
    ], ', '),
    input: 'address',
  },
  {
    key: 'dateOfBirth',
    label: 'Date of birth',
    missingLabel: 'DOB',
    complete: lead => hasText(lead.date_of_birth),
    display: lead => hasText(lead.date_of_birth) ? lead.date_of_birth : null,
    input: 'date',
  },
  {
    key: 'maritalStatus',
    label: 'Marital status',
    missingLabel: 'Marital status',
    complete: lead => hasText(lead.marital_status),
    // Label lookup, not titleCase — 'domestic_partner' renders as its label.
    display: lead => hasText(lead.marital_status)
      ? (maritalStatusLabel(lead.marital_status) || titleCase(lead.marital_status))
      : null,
    input: 'select',
    options: MARITAL_OPTIONS,
  },
  {
    key: 'spouse',
    label: 'Spouse',
    missingLabel: 'Spouse',
    complete: (lead, spouse) => (
      lead.marital_status !== 'married'
      || Boolean(spouse && hasText(spouse.first_name) && hasText(spouse.last_name))
    ),
    display: (_lead, spouse) => spouse ? joined([spouse.first_name, spouse.middle_name, spouse.last_name]) : null,
    input: 'spouse',
  },
  {
    key: 'practiceArea',
    label: 'Practice area',
    missingLabel: 'Practice area',
    complete: lead => hasText(lead.practice_area),
    display: lead => hasText(lead.practice_area) ? practiceAreaLabel(lead.practice_area) : null,
    input: 'select',
    options: PRACTICE_AREA_OPTIONS,
  },
  {
    key: 'source',
    label: 'Lead source',
    missingLabel: 'Lead source',
    complete: lead => hasText(lead.lead_source),
    display: lead => hasText(lead.lead_source) ? lead.lead_source : null,
    input: 'text',
  },
  {
    key: 'fee',
    label: 'Quoted fee',
    missingLabel: 'Quoted fee',
    complete: lead => lead.engagement_fee_quoted != null,
    display: lead => money(lead.engagement_fee_quoted),
    input: 'number',
  },
  {
    key: 'urgency',
    label: 'Urgency',
    missingLabel: 'Urgency',
    complete: lead => hasText(lead.lead_urgency),
    display: lead => hasText(lead.lead_urgency) ? titleCase(lead.lead_urgency) : null,
    input: 'select',
    options: URGENCY_OPTIONS,
  },
  {
    key: 'estimatedEstateValue',
    label: 'Estimated estate value',
    missingLabel: 'Estate value',
    complete: lead => lead.taxable_estate != null,
    display: lead => money(lead.taxable_estate),
    input: 'number',
  },
  {
    key: 'hasMinorChildren',
    label: 'Minor children',
    missingLabel: 'Minor children',
    complete: lead => lead.has_minor_children != null,
    display: lead => lead.has_minor_children == null ? null : lead.has_minor_children ? 'Yes' : 'No',
    input: 'select',
    options: MINOR_CHILDREN_OPTIONS,
  },
  {
    key: 'qualificationNotes',
    label: 'Qualification notes',
    missingLabel: 'Qualification notes',
    complete: lead => hasText(lead.qualification_notes),
    display: lead => hasText(lead.qualification_notes) ? lead.qualification_notes : null,
    input: 'textarea',
  },
  {
    key: 'legalPlan',
    label: 'Plan',
    missingLabel: 'Plan',
    complete: lead => legalPlanDisplayName(lead.billing_type) != null,
    display: lead => legalPlanDisplayName(lead.billing_type),
    input: 'select',
    options: LEGAL_PLAN_OPTIONS,
    applies: isLegalPlanLead,
  },
  {
    key: 'legalPlanMemberId',
    label: 'Member ID',
    missingLabel: 'Member ID',
    complete: lead => hasText(lead.legal_plan_member_id),
    display: lead => hasText(lead.legal_plan_member_id) ? lead.legal_plan_member_id : null,
    input: 'text',
    applies: isLegalPlanLead,
  },
  {
    key: 'legalPlanServiceStart',
    label: 'Service start',
    missingLabel: 'Service start',
    complete: lead => hasText(lead.legal_plan_service_start),
    display: lead => hasText(lead.legal_plan_service_start) ? lead.legal_plan_service_start : null,
    input: 'date',
    applies: isLegalPlanLead,
  },
  {
    key: 'legalPlanServiceEnd',
    label: 'Service end',
    missingLabel: 'Service end',
    complete: lead => hasText(lead.legal_plan_service_end),
    display: lead => hasText(lead.legal_plan_service_end) ? lead.legal_plan_service_end : null,
    input: 'date',
    applies: isLegalPlanLead,
  },
] as const

/** Rail sections. Every definition appears in exactly one group. */
export const LEAD_FIELD_GROUPS: readonly {
  title: string
  keys: readonly LeadEditableField[]
}[] = [
  { title: 'Contact', keys: ['firstName', 'email', 'phone', 'address', 'dateOfBirth'] },
  { title: 'Household', keys: ['maritalStatus', 'spouse', 'hasMinorChildren'] },
  {
    title: 'Qualification',
    keys: ['practiceArea', 'source', 'fee', 'urgency', 'estimatedEstateValue', 'qualificationNotes'],
  },
  {
    title: 'Legal plan',
    keys: ['legalPlan', 'legalPlanMemberId', 'legalPlanServiceStart', 'legalPlanServiceEnd'],
  },
]

/** A group with nothing applicable to this lead is not rendered at all. */
export function leadFieldApplies(definition: LeadFieldDefinition, lead: LeadDetailRecord) {
  return definition.applies?.(lead) ?? true
}

/**
 * Fields the engagement agreement cannot be drafted without. Everything else is
 * useful context but never blocks the conversion.
 */
export const ENGAGEMENT_REQUIRED_FIELDS: readonly LeadEditableField[] = [
  'firstName',
  'email',
  'address',
  'maritalStatus',
  'spouse',
  'practiceArea',
  'fee',
]

export function leadFieldDefinition(key: LeadEditableField): LeadFieldDefinition | undefined {
  return FIELD_DEFINITIONS.find(definition => definition.key === key)
}

export function isNameField(field: LeadEditableField | null): field is LeadNameField {
  return NAME_COMPONENTS.some(component => component.key === field)
}

export function firstMissingNameField(lead: LeadDetailRecord): 'firstName' | 'lastName' {
  return hasText(lead.first_name) ? 'lastName' : 'firstName'
}

export function labelForLeadField(field: LeadEditableField | null) {
  const nameComponent = NAME_COMPONENTS.find(component => component.key === field)
  if (nameComponent) return nameComponent.label
  return leadFieldDefinition(field as LeadEditableField)?.label ?? null
}

export function valueForLeadField(
  field: LeadEditableField,
  lead: LeadDetailRecord,
  spouse: LeadSpouseRecord | null,
): unknown {
  switch (field) {
    case 'firstName': return lead.first_name ?? ''
    case 'middleName': return lead.middle_name ?? ''
    case 'lastName': return lead.last_name ?? ''
    case 'preferredName': return lead.preferred_name ?? ''
    case 'email': return lead.email ?? ''
    case 'phone': return lead.phone ?? ''
    case 'dateOfBirth': return lead.date_of_birth ?? ''
    case 'address': return {
      addressLine1: lead.address_line1 ?? '',
      addressLine2: lead.address_line2 ?? '',
      city: lead.city ?? '',
      state: lead.state ?? '',
      zip: lead.zip ?? '',
      county: lead.county ?? '',
    } satisfies LeadAddressDraft
    case 'maritalStatus': return lead.marital_status ?? ''
    case 'practiceArea': return lead.practice_area ?? ''
    case 'source': return lead.lead_source ?? ''
    case 'fee': return lead.engagement_fee_quoted == null ? '' : String(lead.engagement_fee_quoted)
    case 'urgency': return lead.lead_urgency ?? ''
    case 'estimatedEstateValue': return lead.taxable_estate == null ? '' : String(lead.taxable_estate)
    case 'hasMinorChildren': return lead.has_minor_children == null ? '' : String(lead.has_minor_children)
    case 'qualificationNotes': return lead.qualification_notes ?? ''
    case 'legalPlan': return lead.billing_type ?? ''
    case 'legalPlanMemberId': return lead.legal_plan_member_id ?? ''
    case 'legalPlanServiceStart': return lead.legal_plan_service_start ?? ''
    case 'legalPlanServiceEnd': return lead.legal_plan_service_end ?? ''
    case 'spouse': return {
      firstName: spouse?.first_name ?? '',
      middleName: spouse?.middle_name ?? '',
      lastName: spouse?.last_name ?? '',
      preferredName: spouse?.preferred_name ?? '',
      email: spouse?.email ?? '',
      phone: spouse?.phone ?? '',
      dateOfBirth: spouse?.date_of_birth ?? '',
    } satisfies LeadSpouseDraft
  }
}

function blankToNull(value: string) {
  const trimmed = value.trim()
  return trimmed || null
}

export function normalizedLeadFieldValue(field: LeadEditableField, draft: unknown): unknown {
  if (field === 'address') {
    const address = draft as LeadAddressDraft
    return {
      addressLine1: blankToNull(address.addressLine1),
      addressLine2: blankToNull(address.addressLine2),
      city: blankToNull(address.city),
      state: blankToNull(address.state),
      zip: blankToNull(address.zip),
      county: blankToNull(address.county),
    }
  }
  if (field === 'spouse') {
    const value = draft as LeadSpouseDraft
    return {
      firstName: value.firstName.trim(),
      middleName: blankToNull(value.middleName),
      lastName: value.lastName.trim(),
      preferredName: blankToNull(value.preferredName),
      email: blankToNull(value.email),
      phone: blankToNull(value.phone),
      dateOfBirth: blankToNull(value.dateOfBirth),
    }
  }
  if (field === 'fee' || field === 'estimatedEstateValue') {
    return String(draft).trim() === '' ? null : Number(draft)
  }
  if (field === 'hasMinorChildren') {
    return draft === '' ? null : draft === 'true'
  }
  const value = String(draft).trim()
  return value || null
}
