function digits(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\D/g, '') ?? ''
  return normalized || null
}
export type TelnyxVoiceEvent = {
  data: {
    id: string
    event_type: string
    occurred_at?: string
    payload: Record<string, unknown>
  }
}

const CALL_STATUS_RANK: Record<string, number> = {
  initiated: 0,
  queued: 0,
  ringing: 1,
  'in-progress': 2,
  completed: 3,
  busy: 3,
  'no-answer': 3,
  canceled: 3,
  failed: 3,
}

const TERMINAL_CALL_STATUSES = new Set([
  'completed',
  'busy',
  'no-answer',
  'canceled',
  'failed',
])

const TEXML_CALL_STATUSES = new Set([
  'initiated',
  'ringing',
  'in-progress',
  'completed',
  'busy',
  'no-answer',
  'canceled',
  'failed',
])

function monotonicCallStatus(current: unknown, incoming: unknown): string {
  const currentStatus = typeof current === 'string' ? current : ''
  const incomingStatus = typeof incoming === 'string' ? incoming : ''
  if (!currentStatus) {
    return !incomingStatus || incomingStatus === 'unknown' ? 'initiated' : incomingStatus
  }
  if (!incomingStatus || incomingStatus === 'unknown') return currentStatus
  if (TERMINAL_CALL_STATUSES.has(currentStatus)) return currentStatus
  const currentRank = CALL_STATUS_RANK[currentStatus] ?? -1
  const incomingRank = CALL_STATUS_RANK[incomingStatus] ?? -1
  return incomingRank >= currentRank ? incomingStatus : currentStatus
}

/**
 * Merge webhook call data without allowing a late initiated/ringing event to
 * erase terminal state or timestamps already learned from a newer callback.
 */
export function mergeTelnyxCallRows(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    ...incoming,
    answered_at: incoming.answered_at ?? existing?.answered_at ?? null,
    ended_at: incoming.ended_at ?? existing?.ended_at ?? null,
    duration_seconds: incoming.duration_seconds ?? existing?.duration_seconds ?? null,
    status: monotonicCallStatus(existing?.status, incoming.status),
  }
}

export type TelnyxTexmlStatusCallback = Record<string, string> & {
  CallSid: string
  CallStatus: string
  CallbackSource: 'call-progress-events'
  SequenceNumber: string
}

export function parseTelnyxTexmlStatusCallback(
  rawBody: string,
): TelnyxTexmlStatusCallback | null {
  const params = Object.fromEntries(new URLSearchParams(rawBody))
  const callSid = params.CallSid?.trim()
  const callStatus = params.CallStatus?.trim().toLowerCase()
  const callbackSource = params.CallbackSource?.trim()
  const sequenceNumber = params.SequenceNumber?.trim()
  if (
    !callSid ||
    !callStatus ||
    !TEXML_CALL_STATUSES.has(callStatus) ||
    callbackSource !== 'call-progress-events' ||
    !sequenceNumber ||
    !/^\d+$/.test(sequenceNumber)
  ) {
    return null
  }
  return {
    ...params,
    CallSid: callSid,
    CallStatus: callStatus,
    CallbackSource: 'call-progress-events',
    SequenceNumber: sequenceNumber,
  }
}

function parseTimestamp(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback
}

function parseDuration(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const duration = Number(value)
  return Number.isSafeInteger(duration) ? duration : null
}

export function telnyxTexmlStatusToRow(params: TelnyxTexmlStatusCallback) {
  const directionRaw = (params.Direction ?? '').toLowerCase()
  const direction: 'inbound' | 'outbound' = directionRaw.startsWith('outbound')
    ? 'outbound'
    : 'inbound'
  const from = params.From?.trim() || null
  const to = params.To?.trim() || null
  const participant = direction === 'inbound' ? from : to
  const now = new Date().toISOString()
  const occurredAt = parseTimestamp(
    params.OccurredAt || params.Timestamp,
    now,
  )
  const startedAt = parseTimestamp(
    params.CallInitiatedAt || params.StartTime,
    occurredAt,
  )
  const status = params.CallStatus
  const answeredAt = params.AnsweredTime
    ? parseTimestamp(params.AnsweredTime, occurredAt)
    : status === 'in-progress'
      ? occurredAt
      : null
  const endedAt = TERMINAL_CALL_STATUSES.has(status)
    ? parseTimestamp(params.EndTime || params.OccurredAt, occurredAt)
    : null

  return {
    external_call_id: params.CallSid,
    provider: 'telnyx' as const,
    direction,
    status,
    from_number: from,
    to_number: to,
    participant_number: participant ?? 'unknown',
    participant_digits: digits(participant),
    started_at: startedAt,
    answered_at: answeredAt,
    ended_at: endedAt,
    duration_seconds: parseDuration(params.CallDuration),
    raw_payload: params,
  }
}

export function telnyxVoiceEventToRow(event: TelnyxVoiceEvent) {
  const payload = event.data.payload
  const callId = String(payload.call_control_id ?? payload.call_leg_id ?? '')
  if (!callId) return null
  const direction = payload.direction === 'incoming' ? 'inbound' : 'outbound'
  const from = typeof payload.from === 'string' ? payload.from : null
  const to = typeof payload.to === 'string' ? payload.to : null
  const participant = direction === 'inbound' ? from : to
  const occurredAt = event.data.occurred_at ?? new Date().toISOString()
  const type = event.data.event_type
  const status = type === 'call.initiated'
    ? 'initiated'
    : type === 'call.answered'
      ? 'in-progress'
      : type === 'call.hangup'
        ? 'completed'
        : 'unknown'

  return {
    external_call_id: callId,
    provider: 'telnyx' as const,
    direction,
    status,
    from_number: from,
    to_number: to,
    participant_number: participant ?? 'unknown',
    participant_digits: digits(participant),
    started_at: typeof payload.start_time === 'string' ? payload.start_time : occurredAt,
    answered_at: type === 'call.answered' ? occurredAt : null,
    ended_at: type === 'call.hangup' ? occurredAt : null,
    duration_seconds: typeof payload.duration_millis === 'number'
      ? Math.round(payload.duration_millis / 1000)
      : null,
    raw_payload: event,
  }
}
