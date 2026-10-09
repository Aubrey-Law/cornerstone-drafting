import type { IntakeFormDefinition } from '@/lib/intake/forms/types'
import type { DiscoveryFieldId } from './catalog'
const section = (id: string, title: string, fields: DiscoveryFieldId[]) => ({ id, title, audience: 'staff_only' as const,
  items: fields.map(fieldId => ({ kind: 'field' as const, id: fieldId, fieldId,
    ...(fieldId === 'discovery_insurance_details' ? { condition: { op: 'all' as const, conditions: [
      { op: 'is_set' as const, fieldId: 'discovery_insurance' as const },
      { op: 'not_equals' as const, fieldId: 'discovery_insurance' as const, value: 'none' },
    ] } } : {}) })) })
export const DISCOVERY_TEMPLATE_KEY = 'internal_discovery_call'
export const DISCOVERY_DEFINITION: IntakeFormDefinition = {
  schemaVersion: 1, purpose: 'discovery_call', key: DISCOVERY_TEMPLATE_KEY, title: 'Discovery call',
  description: 'Internal screening. Answers are not shared with the client.',
  sections: [
    section('call', 'Call and contact', ['discovery_call_at', 'discovery_direction', 'discovery_duration', 'discovery_first_name', 'discovery_last_name', 'discovery_email', 'discovery_phone', 'discovery_address_line1', 'discovery_address_line2', 'discovery_city', 'discovery_state', 'discovery_zip', 'discovery_county']),
    section('reason', 'Reason for calling', ['discovery_prompt', 'discovery_goals', 'discovery_timing']),
    section('household', 'Household', ['discovery_marital_status', 'discovery_minor_children', 'discovery_spouse_first_name', 'discovery_spouse_last_name', 'discovery_spouse_email', 'discovery_spouse_phone', 'discovery_household']),
    section('planning', 'Planning overview', ['discovery_existing_plan', 'discovery_assets', 'discovery_estimate', 'discovery_circumstances', 'discovery_insurance', 'discovery_insurance_details']),
    section('outcome', 'Outcome', ['discovery_outcome', 'discovery_rationale', 'discovery_internal_notes', 'discovery_next_action', 'discovery_action_reason']),
  ],
}
