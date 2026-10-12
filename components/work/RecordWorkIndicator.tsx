import Link from 'next/link'
import { Clock3 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { RecordWorkSummary } from '@/lib/work/recordSummary'

const BAND_LABEL: Record<RecordWorkSummary['priorityBand'], string> = {
  0: 'Critical',
  1: 'Today',
  2: 'Soon',
  3: 'Planned',
  4: 'Waiting',
}

const BAND_CLASS: Record<RecordWorkSummary['priorityBand'], string> = {
  0: 'border-destructive/30 bg-red-bg text-destructive',
  1: 'border-amber-border bg-amber-bg text-amber',
  2: 'border-blue-strong-border bg-blue-bg text-blue',
  3: 'border-border bg-muted text-muted-foreground',
  4: 'border-border bg-muted text-muted-foreground',
}

function ownerLabel(summary: RecordWorkSummary): string {
  if (summary.state === 'blocked') return 'Blocked'
  if (summary.state === 'snoozed') return 'Snoozed'
  if (summary.owner === 'client') return 'Waiting on client'
  if (summary.owner === 'automation') return 'Waiting on automation'
  return BAND_LABEL[summary.priorityBand]
}

export function RecordWorkIndicator({
  summary,
  compact = false,
  className,
}: {
  summary: RecordWorkSummary | null | undefined
  compact?: boolean
  className?: string
}) {
  if (!summary) {
    return <span className={cn('text-xs text-muted-foreground', className)}>No current action</span>
  }

  const sla = summary.priorityReasons.filter(reason => reason.code === 'stage_sla')
  const reasons = summary.priorityReasons.filter(reason => reason.code !== 'stage_sla').map(reason => reason.label).join(' · ')
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={cn('shrink-0 text-micro', BAND_CLASS[summary.priorityBand])}>
          {ownerLabel(summary)}
        </Badge>
        {sla.map(reason => (
          <Badge key={reason.code} variant="outline" className={cn('shrink-0 text-micro', BAND_CLASS[summary.priorityBand])}>
            {reason.label}
          </Badge>
        ))}
        <Link href={summary.href} className="min-w-0 truncate text-xs font-medium text-foreground hover:underline">
          {compact ? summary.actionLabel : summary.title}
        </Link>
        <span className="inline-flex shrink-0 items-center gap-1 text-micro text-muted-foreground">
          <Clock3 className="size-3" aria-hidden />
          {summary.estimateMinutes}m
        </span>
      </div>
      {!compact && reasons && (
        <p className="mt-0.5 truncate text-micro text-muted-foreground">{reasons}</p>
      )}
    </div>
  )
}

/** The record-page form of the same summary shown in list rows and cards. */
export function RecordWorkStrip({ summary, prominent = false }: { summary: RecordWorkSummary | null | undefined; prominent?: boolean }) {
  if (!summary) return null
  const reasons = summary.priorityReasons.map(reason => reason.label).join(' · ')
  return (
    <section
      aria-label="Canonical next action"
      className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3 md:px-6"
    >
      <div className="min-w-0 flex-1">
        {prominent && <p className="mb-1 text-xs text-muted-foreground">Next action</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn('text-micro', BAND_CLASS[summary.priorityBand])}>
            {ownerLabel(summary)}
          </Badge>
          <p className={cn("font-medium text-foreground", prominent && "text-lg font-semibold")}>{summary.title}</p>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" aria-hidden />
            {summary.estimateMinutes} minutes
          </span>
        </div>
        {reasons && <p className="mt-0.5 text-xs text-muted-foreground">{reasons}</p>}
      </div>
      <Button asChild size="sm" variant={summary.priorityBand <= 1 ? 'default' : 'outline'}>
        <Link href={summary.href}>{summary.actionLabel}</Link>
      </Button>
    </section>
  )
}
