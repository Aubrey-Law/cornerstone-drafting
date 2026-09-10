'use client'

import { CheckCircle2, Circle, ClipboardList, Copy, Mail, RefreshCw, ShieldX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { type IntakeRow } from '@/lib/intakeSections'
import { INTAKE_TRACK_OPTIONS, getIntakeTrack, type IntakeTrack } from '@/lib/intakeTrack'
import { getLeadIntakeProgress } from '@/lib/leads/intakeProgress'

interface LeadIntakeCardProps {
  intake: IntakeRow
  intakeUrl: string | null
  /** The standing link was deliberately revoked — copying must not revive it. */
  linkRevoked?: boolean
  onOpen: () => void
  onCopy: () => void
  onEmail?: () => void
  onText?: () => void
  onRotate?: () => void
  onRevoke?: () => void
  onTrackChange?: (track: IntakeTrack) => void
  busy?: boolean
}

function stateLine(intake: IntakeRow, completed: number, total: number): string {
  const status = typeof intake.status === 'string' ? intake.status.toLowerCase() : ''
  const sent = Boolean(intake.intake_sent_at) || ['sent', 'submitted', 'approved'].includes(status)
  const submitted = status === 'submitted' || status === 'approved'
  return `${sent ? 'Sent' : 'Never sent'} · ${submitted ? 'submitted' : 'nothing submitted'} · ${completed} of ${total} sections`
}

export function LeadIntakeCard({
  intake, intakeUrl, linkRevoked = false, onOpen, onCopy, onEmail, onRotate, onRevoke,
  onTrackChange, busy = false,
}: LeadIntakeCardProps) {
  const segments = getLeadIntakeProgress(intake)
  const completed = segments.filter((segment) => segment.complete).length
  const track = getIntakeTrack(intake)
  const status = typeof intake.status === 'string' ? intake.status.toLowerCase() : ''
  const trackLocked = status === 'submitted' || status === 'approved'

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-label="Lead intake">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold">Intake</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {stateLine(intake, completed, segments.length)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={onOpen}>Open intake</Button>
          {/* A lead that has never had a link prepared — every lead created
              from a booking — still copies: the handler issues one first. Only
              a revoked link is a dead end, and that one was deliberate. */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onCopy}
            disabled={linkRevoked || busy}
            aria-describedby={linkRevoked ? 'intake-link-unavailable' : undefined}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy link
          </Button>
          {onEmail && (
            <Button type="button" size="sm" variant="outline" onClick={onEmail} disabled={!intakeUrl || busy}>
              <Mail className="h-3.5 w-3.5" /> Email link
            </Button>
          )}
          {onRotate && (
            <Button type="button" size="sm" variant="ghost" onClick={onRotate} disabled={busy}>
              <RefreshCw className="h-3.5 w-3.5" /> {intakeUrl ? 'Replace' : 'Prepare link'}
            </Button>
          )}
          {onRevoke && (
            <Button type="button" size="sm" variant="ghost" onClick={onRevoke} disabled={!intakeUrl || busy}>
              <ShieldX className="h-3.5 w-3.5" /> Revoke
            </Button>
          )}
        </div>
      </div>
      {linkRevoked && (
        <p id="intake-link-unavailable" className="mt-2 text-xs text-muted-foreground">
          This intake link was revoked. Use <span className="font-medium">Prepare link</span> to issue a new one.
        </p>
      )}
      {onTrackChange && (
        <div className="mt-3 rounded-md border border-border p-3">
          <p className="text-xs font-medium text-foreground">Questionnaire</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose before sending the link — it decides which questions the client is asked.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {INTAKE_TRACK_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={track === option.value ? 'default' : 'outline'}
                aria-pressed={track === option.value}
                disabled={busy || trackLocked || track === option.value}
                title={option.sub}
                onClick={() => onTrackChange(option.value)}
              >
                {option.title}
              </Button>
            ))}
          </div>
          {trackLocked && (
            <p className="mt-2 text-xs text-muted-foreground">
              Submitted — unlock the intake to change the questionnaire.
            </p>
          )}
        </div>
      )}
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Intake progress">
        {segments.map((segment) => (
          <li
            key={segment.id}
            className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs"
            aria-label={`${segment.label}: ${segment.complete ? 'complete' : 'incomplete'}`}
          >
            {segment.complete
              ? <CheckCircle2 className="h-3.5 w-3.5 text-green" aria-hidden="true" />
              : <Circle className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
            <span>{segment.label}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
