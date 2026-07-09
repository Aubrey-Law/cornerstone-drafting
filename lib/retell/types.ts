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
