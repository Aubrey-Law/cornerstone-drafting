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
