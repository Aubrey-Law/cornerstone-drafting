/* ─── Leads Pipeline Types ────────────────────────────────────────────────── */

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'consult_booked'
  | 'consult_held'
  | 'proposal_sent'
  | 'engagement_sent'
  | 'hired'
  | 'lost'
  | 'nurture'

export type LeadUrgency = 'low' | 'normal' | 'high'

export type LeadSourceChannel =
  | 'website'
  | 'referral'
  | 'legal_plan'
  | 'calcom'
  | 'lawmatics_legacy'
  | 'manual'

export type LeadLostReason =
  | 'price'
  | 'timing'
  | 'went_diy'
  | 'chose_other_firm'
  | 'unresponsive'
  | 'other'
  | 'manual_delete'

export type LeadActivityType =
  | 'created'
  | 'status_change'
  | 'note'
  | 'call'
  | 'email_sent'
  | 'email_received'
  | 'sms'
  | 'meeting'
  | 'consult_scheduled'
  | 'task'
  | 'document'
  | 'converted'
  | 'lost'
  | 'agreement_sent'
  | 'agreement_viewed'
  | 'agreement_signed'
  | 'agreement_voided'
  | 'conflict_check_decided'

export type LeadTaskStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled'

export type LeadTaskPriority = 'low' | 'medium' | 'high' | 'urgent'

export interface Lead {
  id: string
  created_at: string
  updated_at: string

  first_name: string
  middle_name: string | null
  last_name: string
  suffix?: string | null
  preferred_name?: string | null
  preferred_pronoun?: string | null
  date_of_birth?: string | null
  email: string | null
  phone: string | null

  spouse_first_name: string | null
  spouse_middle_name: string | null
  spouse_last_name: string | null
  spouse_email: string | null
  spouse_phone: string | null

  street: string | null
  city: string | null
  state: string | null
  zip: string | null

  status: LeadStatus
  status_changed_at: string
  practice_area_interest: string | null

  estimated_estate_value: number | null
  has_minor_children: boolean | null
  marital_status: string | null
  urgency: LeadUrgency | null
  qualification_notes: string | null

  source_channel: LeadSourceChannel | null
  campaign_id: string | null
  referral_source_id: string | null
  referral_organization_id: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null

  lost_reason: LeadLostReason | null
  lost_notes: string | null
  converted_matter_id: string | null
  converted_at: string | null

  owner_user_id: string | null
  internal_notes: string | null

  deleted_at: string | null
}

export const LEAD_PIPELINE_STATUSES: { key: LeadStatus; label: string; color: string }[] = [
  { key: 'new',            label: 'New',            color: 'oklch(0.55 0.12 240)' },
  { key: 'contacted',      label: 'Contacted',      color: 'oklch(0.56 0.13 220)' },
  { key: 'consult_booked', label: 'Consult Booked', color: 'oklch(0.58 0.14 200)' },
  { key: 'consult_held',   label: 'Consult Held',   color: 'oklch(0.55 0.14 160)' },
  { key: 'proposal_sent',  label: 'Proposal Sent',  color: 'oklch(0.60 0.14 70)' },
  { key: 'engagement_sent', label: 'Engagement Sent', color: 'oklch(0.58 0.16 45)' },
]

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  consult_booked: 'Consult Booked',
  consult_held: 'Consult Held',
  proposal_sent: 'Proposal Sent',
  engagement_sent: 'Engagement Sent',
  hired: 'Hired',
  lost: 'Lost',
  nurture: 'Nurture',
}

export const LEAD_SOURCE_LABELS: Record<LeadSourceChannel, string> = {
  website: 'Website',
  referral: 'Referral',
  legal_plan: 'Legal Plan',
  calcom: 'Cal.com',
  lawmatics_legacy: 'Lawmatics Legacy',
  manual: 'Manual',
}

export const LEAD_LOST_REASONS: { value: LeadLostReason; label: string }[] = [
  { value: 'price',            label: 'Price' },
  { value: 'timing',           label: 'Timing' },
  { value: 'went_diy',         label: 'Went DIY' },
  { value: 'chose_other_firm', label: 'Chose Other Firm' },
  { value: 'unresponsive',     label: 'Unresponsive' },
  { value: 'other',            label: 'Other' },
]

export interface LeadPipelineRow {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  status: LeadStatus
  status_changed_at: string
  practice_area_interest: string | null
  estimated_estate_value: number | null
  urgency: LeadUrgency | null
  source_channel: LeadSourceChannel | null
  created_at: string
  converted_matter_id: string | null
  days_in_stage: number
  last_activity_at: string | null
  overdue_task_count: number
  engagement_status: string | null
}

/**
 * Per-type payload shapes for lead_activity.payload.
 * Stored as JSONB in the database; this discriminated union
 * documents the expected shapes for callers.
 */
export type LeadActivityPayload =
  | { type: 'created'; payload: Record<string, never> }
  | { type: 'status_change'; payload: { from: LeadStatus; to: LeadStatus } }
  | { type: 'note'; payload: { text: string } }
  | { type: 'call'; payload: { duration_min: number; direction: 'inbound' | 'outbound'; notes?: string } }
  | { type: 'email_sent'; payload: { to: string; subject: string; email_log_id?: string } }
  | { type: 'email_received'; payload: { from: string; subject: string } }
  | { type: 'sms'; payload: { direction: 'inbound' | 'outbound'; body: string } }
  | { type: 'meeting'; payload: { calendar_event_id: string; when: string; location?: string } }
  | { type: 'consult_scheduled'; payload: { when: string; location?: string | null; notes?: string | null } }
  | { type: 'task'; payload: { task_id: string; action: 'created' | 'completed' | 'cancelled' } }
  | { type: 'document'; payload: { document_id: string; action: 'uploaded' | 'sent' } }
  | { type: 'converted'; payload: { matter_id: string } }
  | { type: 'lost'; payload: { reason: LeadLostReason; notes?: string } }
  | { type: 'agreement_sent'; payload: { agreement_id: string; send_status?: string; recipient?: string; provider?: 'docuseal' | 'signwell'; external_id?: string; external_url?: string | null } }
  | { type: 'agreement_viewed'; payload: { agreement_id?: string } }
  | { type: 'agreement_signed'; payload: { agreement_id?: string; matter_id?: string } }
  | { type: 'agreement_voided'; payload: { agreement_id?: string; reason?: string } }
  | { type: 'conflict_check_decided'; payload: { decision: string; check_id?: string; reason?: string | null } }

export interface LeadActivity {
  id: string
  lead_id: string
  created_at: string
  actor_user_id: string | null
  type: LeadActivityType
  payload: Record<string, unknown>
}

export interface LeadTask {
  id: string
  lead_id: string
  parent_id: string | null
  created_at: string
  due_date: string | null
  title: string
  description: string | null
  status: LeadTaskStatus
  priority: LeadTaskPriority
  stage: LeadStatus | null
  assignee: string | null
  completed_at: string | null
  subtasks?: LeadTask[]
}

export interface LeadTaskTemplateSubtask {
  id: string
  template_id: string
  title: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface LeadTaskTemplate {
  id: string
  lead_stage: LeadStatus
  title: string
  priority: LeadTaskPriority
  default_status: 'open' | 'in_progress' | 'blocked' | 'done'
  due_days_offset: number | null
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
  subtasks?: LeadTaskTemplateSubtask[]
}

export interface LeadDocument {
  id: string
  lead_id: string
  r2_key: string
  name: string
  size: number
  content_type: string
  kind: 'general' | 'meeting-notes'
  uploaded_by: string | null
  created_at: string
}
