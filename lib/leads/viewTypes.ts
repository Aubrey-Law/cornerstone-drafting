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
  created_at?: string | null
  updated_at?: string | null
  intake_sent_at?: string | null
  intake_completed_at?: string | null
  intake_status?: string | null
  lead_next_action_snoozed_until?: string | null
  user_id?: string | null
  client_user_id?: string | null
  matter_id?: string | null
}

export interface LeadSpouseRecord {
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
