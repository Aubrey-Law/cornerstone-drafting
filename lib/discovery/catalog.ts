import { getBuilderField as canonicalField, type BuilderFieldDef, type SharedFieldId, type SharedFieldControl, type FieldOption, PLANNING_GOAL_OPTIONS, INTAKE_ASSET_TYPE_OPTIONS, MARITAL_STATUS_OPTIONS } from '@aubrey-law/estate-fields/core'
import { LEGAL_PLAN_OPTIONS } from '@/lib/billing/billingType'

const options = (...values: string[]): FieldOption[] => values.map(value => ({ value, label: value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()) }))
const fields = {
  discovery_call_at: ['Call date and time (Eastern)', 'text'],
  discovery_direction: ['Direction', 'select', options('inbound', 'outbound')],
  discovery_duration: ['Duration (minutes)', 'text'],
  discovery_first_name: ['First name', 'text'], discovery_last_name: ['Last name', 'text'],
  discovery_email: ['Email', 'email'], discovery_phone: ['Phone', 'tel'],
  discovery_address_line1: ['Street', 'text'], discovery_address_line2: ['Address line 2', 'text'],
  discovery_city: ['City', 'text'], discovery_state: ['State', 'text'], discovery_zip: ['ZIP', 'text'], discovery_county: ['County', 'text'],
  discovery_prompt: ['What prompted the call?', 'textarea'],
  discovery_goals: ['Planning goals', 'multiselect', PLANNING_GOAL_OPTIONS],
  discovery_timing: ['Timing concerns', 'textarea'],
  discovery_marital_status: ['Marital status', 'select', MARITAL_STATUS_OPTIONS],
  discovery_minor_children: ['Minor children', 'select', options('yes', 'no', 'unknown')],
  discovery_spouse_first_name: ['Spouse / partner first name', 'text'], discovery_spouse_last_name: ['Spouse / partner last name', 'text'],
  discovery_spouse_email: ['Spouse / partner email', 'email'], discovery_spouse_phone: ['Spouse / partner phone', 'tel'],
  discovery_household: ['Household notes', 'textarea'],
  discovery_existing_plan: ['Existing estate plan', 'select', options('yes', 'no', 'unknown')],
  discovery_assets: ['Broad asset categories', 'multiselect', INTAKE_ASSET_TYPE_OPTIONS],
  discovery_estimate: ['Estimated estate value (optional)', 'text'],
  discovery_circumstances: ['Circumstances needing attorney attention', 'textarea'],
  discovery_insurance: ['Legal insurance', 'select', [{ value: 'none', label: 'None / not known' }, ...LEGAL_PLAN_OPTIONS]],
  discovery_insurance_details: ['Employer / member ID / coverage notes', 'textarea'],
  discovery_outcome: ['Outcome', 'select', options('proceed', 'needs_review', 'not_a_fit')],
  discovery_rationale: ['Outcome rationale', 'textarea'], discovery_internal_notes: ['Internal notes', 'textarea'],
  discovery_next_action: ['Next action', 'select', options('send_organizer', 'schedule_meeting', 'request_information', 'attorney_review', 'other_follow_up', 'no_further_action')],
  discovery_action_reason: ['Next-action details / reason for no further action', 'textarea'],
} as const satisfies Record<string, readonly [string, SharedFieldControl, (readonly FieldOption[])?]>
export type DiscoveryFieldId = keyof typeof fields
export type FormFieldId = SharedFieldId | DiscoveryFieldId
export const DISCOVERY_FIELD_IDS = Object.keys(fields) as DiscoveryFieldId[]
export const REQUIRED_DISCOVERY_FIELDS: DiscoveryFieldId[] = ['discovery_call_at', 'discovery_outcome', 'discovery_next_action']
export const MANDATORY_DISCOVERY_FIELDS: DiscoveryFieldId[] = [...REQUIRED_DISCOVERY_FIELDS, 'discovery_action_reason']
export function isDiscoveryField(id: string): id is DiscoveryFieldId { return Object.hasOwn(fields, id) }
export function getFormField(id: string): BuilderFieldDef {
  if (!isDiscoveryField(id)) return canonicalField(id)
  const entry: readonly [string, SharedFieldControl, (readonly FieldOption[])?] = fields[id]
  return { id, label: entry[0], control: entry[1], options: entry[2], builderEnabled: true,
    baselineRequirement: REQUIRED_DISCOVERY_FIELDS.includes(id) ? 'required' : 'optional', validationProfile: 'none',
    read: data => data[id], write: (value, update) => update(id, value) }
}
export const readFormField = (id: string, data: Readonly<Record<string, unknown>>) => getFormField(id).read(data)
export function discoveryFieldError(id: DiscoveryFieldId, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const field = getFormField(id)
  if (field.control === 'multiselect') return Array.isArray(value) && value.every(v => typeof v === 'string' && field.options?.some(o => o.value === v)) ? null : 'Choose approved options.'
  if (typeof value !== 'string' || value.length > 10000) return 'Enter text (at most 10,000 characters).'
  if (field.options && !field.options.some(o => o.value === value)) return 'Choose an approved option.'
  if (field.control === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email.'
  if (id === 'discovery_duration' || id === 'discovery_estimate') {
    const amount = value.replace(/[$,]/g, '').trim()
    if (!/^\d+(\.\d+)?$/.test(amount) || !Number.isFinite(Number(amount))) return 'Enter a nonnegative number.'
  }
  if (id === 'discovery_call_at') {
    const parsed = new Date(`${value}Z`)
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,16) !== value) return 'Enter a valid call date and time (Eastern).'
  }
  return null
}
