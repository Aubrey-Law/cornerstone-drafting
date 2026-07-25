'use client'

import { CheckCircle2, Circle, ClipboardList, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { type IntakeRow } from '@/lib/intakeSections'
import { getLeadIntakeProgress } from '@/lib/leads/intakeProgress'

interface LeadIntakeCardProps {
  intake: IntakeRow
  intakeUrl: string | null
  onOpen: () => void
  onCopy: () => void
}

function stateLine(intake: IntakeRow, completed: number): string {
  const status = typeof intake.status === 'string' ? intake.status.toLowerCase() : ''
  const sent = Boolean(intake.intake_sent_at) || ['sent', 'submitted', 'approved'].includes(status)
  const submitted = status === 'submitted' || status === 'approved'
  return `${sent ? 'Sent' : 'Never sent'} · ${submitted ? 'submitted' : 'nothing submitted'} · ${completed} of 7 sections`
}

export function LeadIntakeCard({ intake, intakeUrl, onOpen, onCopy }: LeadIntakeCardProps) {
  const segments = getLeadIntakeProgress(intake)
  const completed = segments.filter((segment) => segment.complete).length

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-label="Lead intake">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold">Intake</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{stateLine(intake, completed)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={onOpen}>Open intake</Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onCopy}
            disabled={!intakeUrl}
            aria-describedby={!intakeUrl ? 'intake-link-unavailable' : undefined}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy link
          </Button>
        </div>
      </div>
      {!intakeUrl && <p id="intake-link-unavailable" className="sr-only">An intake link is not available to copy yet.</p>}
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
