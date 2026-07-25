'use client'

import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Voicemail } from 'lucide-react'
import { formatPhoneDisplay } from '@/lib/phone'
import { formatDate } from '@/lib/utils'

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

function durationLabel(secs: number | null): string | null {
  if (!secs || secs <= 0) return null
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function iconFor(call: CallRowData): { Icon: typeof PhoneIncoming; label: string } {
  if (call.voicemail_url) return { Icon: Voicemail, label: 'Voicemail' }
  if (call.status === 'missed' || call.status === 'no-answer') {
    return { Icon: PhoneMissed, label: 'Missed call' }
  }
  return call.direction === 'inbound'
    ? { Icon: PhoneIncoming, label: 'Inbound call' }
    : { Icon: PhoneOutgoing, label: 'Outbound call' }
}

export function CallRow({ call }: { call: CallRowData }) {
  const { Icon, label } = iconFor(call)
  const phone = formatPhoneDisplay(call.participant_number)
  const metadata = [
    call.direction,
    call.status,
    durationLabel(call.duration_seconds),
    call.firm_user_email,
  ].filter(Boolean).join(' · ')
  return (
    <div className="flex items-start gap-3 px-3 py-2">
      <Icon className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-label={label} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium">{phone}</span>
          <span className="text-xs text-muted-foreground">{formatDate(call.started_at)}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {metadata}
        </div>
        {call.summary ? <div className="mt-1 text-sm">{call.summary}</div> : null}
        {call.recording_url ? (
          <a
            href={call.recording_url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Recording for call with ${phone}`}
            className="text-xs text-primary underline"
          >
            Recording
          </a>
        ) : null}
      </div>
    </div>
  )
}
