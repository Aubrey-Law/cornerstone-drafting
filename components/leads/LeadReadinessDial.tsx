'use client'

import { computeLeadReadiness } from '@/lib/leads/readiness'
import { cn } from '@/lib/utils'
import type { LeadDetailRecord, LeadSpouseRecord } from '@/lib/leads/viewTypes'

type LeadReadinessDialProps = {
  lead: LeadDetailRecord
  spouse: LeadSpouseRecord | null
  className?: string
}

function missingSummary(labels: string[]): string {
  if (labels.length === 0) return 'Every required item is answered.'
  const shown = labels.slice(0, 3).join(', ')
  const rest = labels.length - 3
  return rest > 0 ? `Missing ${shown} +${rest} more` : `Missing ${shown}`
}

export function LeadReadinessDial({ lead, spouse, className }: LeadReadinessDialProps) {
  const readiness = computeLeadReadiness(lead, spouse)
  const ringColor = readiness.ready ? 'var(--green)' : 'var(--amber-orange)'

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md border p-2',
        readiness.ready ? 'border-green/40 bg-green-bg' : 'border-amber-border bg-amber-bg',
        className,
      )}
    >
      <div
        aria-hidden
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
        style={{ background: `conic-gradient(${ringColor} ${readiness.percent}%, var(--muted) 0)` }}
      >
        <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-card text-[11px] font-semibold tabular-nums">
          {readiness.percent}%
        </span>
      </div>
      <div className="min-w-0">
        <p
          aria-label={`Lead readiness ${readiness.percent} percent`}
          className={cn('text-sm font-semibold', readiness.ready ? 'text-green' : 'text-amber')}
        >
          {readiness.ready ? 'Ready to convert' : 'Not ready yet'}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {missingSummary(readiness.missing.map(item => item.label))}
        </p>
      </div>
    </div>
  )
}
