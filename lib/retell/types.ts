export type RetellWebhookEvent =
  | 'call_started'
  | 'call_ended'
  | 'call_analyzed'
  | 'transcript_updated'
  | string

export interface RetellCallAnalysis {
  call_summary?: string | null
  in_voicemail?: boolean | null
  user_sentiment?: string | null
  call_successful?: boolean | null
  /**
   * Fields the Retell agent is configured to extract after the call. The
   * receptionist follow-up reads caller_name, caller_email, caller_phone,
   * reason, wants_appointment and requested_time when present, and falls
   * back to the light model over the summary and transcript when not.
   */
  custom_analysis_data?: Record<string, unknown> | null
}

export interface RetellCall {
  call_id: string
  call_status?: string | null
  direction?: 'inbound' | 'outbound' | string | null
  from_number?: string | null
  to_number?: string | null
  start_timestamp?: number | null
  end_timestamp?: number | null
  duration_ms?: number | null
  transcript?: string | null
  recording_url?: string | null
  scrubbed_recording_url?: string | null
  disconnection_reason?: string | null
  call_analysis?: RetellCallAnalysis | null
}

export interface RetellWebhookPayload {
  event: RetellWebhookEvent
  call?: RetellCall
}
