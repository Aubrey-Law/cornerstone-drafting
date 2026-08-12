export interface LeadListRow {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  practice_area: string | null
  status: string | null
  lead_status: string | null
  matter_id: string | null
  intake_sent_at: string | null
  intake_completed_at: string | null
  engagement_status: string | null
  engagement_sent_at: string | null
  engagement_signed_at: string | null
  engagement_fee_quoted: number | null
  created_at: string | null
  updated_at: string | null
  lead_urgency: string | null
  taxable_estate: number | null
  last_activity_at: string | null
  // Loaded so the index record side panel can edit the same fields as the lead
  // detail rail. Optional because narrower callers still build LeadListRow.
  middle_name?: string | null
  preferred_name?: string | null
  date_of_birth?: string | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  county?: string | null
  marital_status?: string | null
  qualification_notes?: string | null
  has_minor_children?: boolean | null
  lead_source?: string | null
  intake_status?: string | null
  lead_next_action_snoozed_until?: string | null
  user_id?: string | null
  client_user_id?: string | null
}

/**
 * Lead detail view model returned by the admin lead loader and mutation routes.
 * Optional fields let focused cards consume a subset without redefining the
 * persisted record shape.
 */
export interface LeadDetailRecord {
  [key: string]: unknown
  id: string
  first_name: string | null
  middle_name: string | null
  last_name: string | null
  preferred_name: string | null
  full_name: string | null
  email: string | null
  phone: string | null
  date_of_birth: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  marital_status: string | null
  practice_area: string | null
  lead_source: string | null
  lead_status: string
  engagement_fee_quoted: number | null
  lead_urgency?: string | null
  taxable_estate?: number | null
  has_minor_children?: boolean | null
  qualification_notes?: string | null
  billing_type?: string | null
  legal_plan_member_id?: string | null
  legal_plan_service_start?: string | null
  legal_plan_service_end?: string | null
  created_at?: string | null
  updated_at?: string | null
  intake_sent_at?: string | null
  intake_completed_at?: string | null
  intake_status?: string | null
  engagement_status?: string | null
  engagement_sent_at?: string | null
  engagement_signed_at?: string | null
  lead_next_action_snoozed_until?: string | null
  user_id?: string | null
  client_user_id?: string | null
  matter_id?: string | null
}

export interface LeadSpouseRecord {
  /** Secondary emails/phones, as stored on the contact row. */
  additional_emails?: unknown
  additional_phones?: unknown
  first_name?: string | null
  middle_name?: string | null
  last_name?: string | null
  preferred_name?: string | null
  email?: string | null
  phone?: string | null
  date_of_birth?: string | null
}

export interface LeadActivityViewRow {
  id: string
  event_type?: string | null
  title: string
  detail?: string | null
  actor_id?: string | null
  created_at: string
}

/**
 * Lead lifecycle states the app may set directly. `hired` is absent on purpose:
 * hiring runs through the convert endpoint, which assigns the matter number and
 * seeds the SLA checklist, so it is never a plain status write.
 */
export type MutableLeadStatus = 'lead' | 'lost' | 'declined'

export const MUTABLE_LEAD_STATUS_LABEL: Record<MutableLeadStatus, string> = {
  lead: 'Lead',
  lost: 'Lost',
  declined: 'Declined',
}
