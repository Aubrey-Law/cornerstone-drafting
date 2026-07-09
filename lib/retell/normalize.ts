import type { RetellCall, RetellWebhookPayload } from './types'

export interface RetellCallRowInsert {
  external_call_id: string
  provider: 'retell'
  direction: 'inbound' | 'outbound'
  status: string
  from_number: string
  to_number: string
  participant_number: string
  firm_user_id: string | null
  firm_user_email: string | null
  started_at: string
  answered_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  recording_url: string | null
  voicemail_url: string | null
  transcript: string | null
  summary: string | null
  raw_payload: Record<string, unknown>
}

export const RETELL_UPSERT_EVENTS = new Set([
  'call_started',
  'call_ended',
  'call_analyzed',
])

function mapRetellStatus(call: RetellCall): string {
  const status = (call.call_status ?? '').toLowerCase()
  const reason = (call.disconnection_reason ?? '').toLowerCase()
  const analysis = call.call_analysis

  if (analysis?.in_voicemail) return 'voicemail'

  switch (status) {
    case 'registered':
      return 'queued'
    case 'ongoing':
      return 'in-progress'
    case 'not_connected':
      if (reason.includes('no_answer') || reason.includes('dial_no_answer')) return 'no-answer'
      if (reason.includes('busy') || reason.includes('dial_busy')) return 'busy'
      if (reason.includes('failed') || reason.includes('dial_failed')) return 'failed'
      return 'no-answer'
    case 'error':
      return 'failed'
    case 'ended':
      return 'completed'
    default:
      return status || 'unknown'
  }
}

function msToIso(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null
  return new Date(ms).toISOString()
}

function durationSeconds(call: RetellCall): number | null {
  if (typeof call.duration_ms === 'number' && Number.isFinite(call.duration_ms) && call.duration_ms >= 0) {
    return Math.round(call.duration_ms / 1000)
  }
  if (
    typeof call.start_timestamp === 'number' &&
    typeof call.end_timestamp === 'number' &&
    call.end_timestamp >= call.start_timestamp
  ) {
    return Math.round((call.end_timestamp - call.start_timestamp) / 1000)
  }
  return null
}

export function retellWebhookToRow(payload: RetellWebhookPayload): RetellCallRowInsert | null {
  const call = payload.call
  const callId = call?.call_id?.trim()
  if (!call || !callId) return null

  const directionRaw = (call.direction ?? 'inbound').toLowerCase()
  const direction: 'inbound' | 'outbound' = directionRaw === 'outbound' ? 'outbound' : 'inbound'

  const from = call.from_number?.trim() || ''
  const to = call.to_number?.trim() || ''
  const participant = direction === 'inbound' ? from || to : to || from

  const now = new Date().toISOString()
  const startedAt = msToIso(call.start_timestamp) ?? now
  const endedAt = msToIso(call.end_timestamp)
  const status = mapRetellStatus(call)
  const analysis = call.call_analysis

  let answeredAt: string | null = null
  if (status === 'in-progress' || status === 'completed' || status === 'voicemail') {
    answeredAt = startedAt
  }

  const summary = analysis?.call_summary?.trim() || null
  const transcript = call.transcript?.trim() || null
  const recordingUrl =
    call.recording_url?.trim() || call.scrubbed_recording_url?.trim() || null

  return {
    external_call_id: callId,
    provider: 'retell',
    direction,
    status,
    from_number: from || participant || 'unknown',
    to_number: to || participant || 'unknown',
    participant_number: participant || from || to || 'unknown',
    firm_user_id: null,
    firm_user_email: null,
    started_at: startedAt,
    answered_at: answeredAt,
    ended_at: endedAt,
    duration_seconds: durationSeconds(call),
    recording_url: recordingUrl,
    voicemail_url: analysis?.in_voicemail ? recordingUrl : null,
    transcript,
    summary,
    raw_payload: {
      event: payload.event,
      call,
    },
  }
}
