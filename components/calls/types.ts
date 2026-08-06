export interface CallRowData {
  id: string
  direction: 'inbound' | 'outbound'
  status: string
  participant_number: string
  started_at: string
  duration_seconds: number | null
  recording_url: string | null
  voicemail_url: string | null
  summary: string | null
  firm_user_email: string | null
}

export interface LinkedCallRow extends CallRowData {
  matter_id: string | null
  lead_id: string | null
  contact_id: string | null
  triage_dismissed_at?: string | null
}
