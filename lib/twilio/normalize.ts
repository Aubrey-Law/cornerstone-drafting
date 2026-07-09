export interface TwilioCallRowInsert {
  external_call_id: string
  provider: 'twilio'
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
  raw_payload: Record<string, string>
}

function parseClientIdentity(value: string): string | null {
  if (value.startsWith('client:')) return value.slice('client:'.length) || null
  return null
}

function mapTwilioStatus(status: string): string {
  switch (status) {
    case 'no-answer':
      return 'no-answer'
    case 'busy':
      return 'busy'
    case 'failed':
      return 'failed'
    case 'canceled':
      return 'canceled'
    case 'completed':
      return 'completed'
    case 'in-progress':
      return 'in-progress'
    case 'ringing':
      return 'ringing'
    case 'queued':
      return 'queued'
    default:
      return status || 'unknown'
  }
}

function parseTimestamp(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback
}

function parseDuration(value: string | undefined): number | null {
  if (!value) return null
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * Map a Twilio Voice status-callback form body to a `calls` row.
 * Upsert on `external_call_id` (CallSid); later events enrich the same row.
 */
export function twilioStatusToRow(params: Record<string, string>): TwilioCallRowInsert | null {
  const callSid = params.CallSid?.trim()
  if (!callSid) return null

  const from = params.From ?? ''
  const to = params.To ?? ''
  const directionRaw = (params.Direction ?? '').toLowerCase()
  const direction: 'inbound' | 'outbound' = directionRaw.startsWith('inbound')
    ? 'inbound'
    : 'outbound'

  const fromClient = parseClientIdentity(from)
  const toClient = parseClientIdentity(to)
  const firmUserId = fromClient ?? toClient

  let participant = direction === 'inbound' ? from : to
  if (participant.startsWith('client:')) {
    participant = direction === 'inbound' ? to : from
  }

  const now = new Date().toISOString()
  const status = mapTwilioStatus(params.CallStatus ?? '')
  const durationSeconds = parseDuration(params.CallDuration)
  const startedAt = parseTimestamp(params.Timestamp, now)

  let answeredAt: string | null = null
  let endedAt: string | null = null

  if (status === 'in-progress' || status === 'completed') {
    answeredAt = parseTimestamp(params.StartTime, startedAt)
  }
  if (
    status === 'completed' ||
    status === 'busy' ||
    status === 'failed' ||
    status === 'no-answer' ||
    status === 'canceled'
  ) {
    endedAt = parseTimestamp(params.EndTime, now)
  }

  return {
    external_call_id: callSid,
    provider: 'twilio',
    direction,
    status,
    from_number: from,
    to_number: to,
    participant_number: participant,
    firm_user_id: firmUserId,
    firm_user_email: null,
    started_at: startedAt,
    answered_at: answeredAt,
    ended_at: endedAt,
    duration_seconds: durationSeconds,
    recording_url: params.RecordingUrl?.trim() || null,
    voicemail_url: null,
    transcript: null,
    summary: null,
    raw_payload: params,
  }
}
