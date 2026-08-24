import { Badge } from '@/components/ui/badge'
import { leadScoreBandLabel, topLeadScoreReasons, type LeadScore } from '@/lib/leads/score'
import { cn } from '@/lib/utils'

/**
 * The lead score pill, shared by the leads table, the board cards and the
 * record side panel. Tones follow the billing badge vocabulary so a hot lead
 * reads like an overdue invoice does — the eye is meant to land on it.
 */
const bandClasses = {
  hot: 'border-destructive/30 bg-red-bg text-destructive',
  warm: 'border-stage-work/30 bg-stage-work-bg text-stage-work-text',
  cool: 'border-blue-strong-border bg-blue-bg text-blue',
  cold: 'border-border bg-muted text-muted-foreground',
}

export function LeadScoreBadge({
  score,
  /** A hired, lost or declined lead keeps its score but stops competing for attention. */
  muted = false,
  showLabel = true,
  className,
}: {
  score: LeadScore
  muted?: boolean
  showLabel?: boolean
  className?: string
}) {
  const label = leadScoreBandLabel(score.band)
  const reasons = topLeadScoreReasons(score)
  // The pill shows the raw score, because that is what the list is ordered by.
  // The band comes from the share of the points this lead could earn, so the
  // tooltip states both — otherwise a 57 reading "Hot" looks like a bug.
  const outOf = `${score.score}/100 · ${score.percent}% of the ${score.attainable} points on offer`
  const title = reasons.length > 0
    ? `${label} · ${outOf} — ${reasons.map(reason => reason.reason).join('; ')}`
    : `${label} · ${outOf}`

  return (
    <Badge
      variant="outline"
      title={title}
      aria-label={`Lead score ${score.score} of 100, ${score.percent}% of what this lead could earn, ${label}`}
      className={cn(
        'tabular-nums',
        muted ? 'border-border bg-muted text-muted-foreground' : bandClasses[score.band],
        className,
      )}
    >
      {score.score}
      {showLabel ? <span className="font-normal opacity-80">{label}</span> : null}
    </Badge>
  )
}
