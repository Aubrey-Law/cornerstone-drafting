'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { apiRequest } from '@/lib/clientApi'
import {
  leadScoreBandLabel,
  leadScoreIsActive,
  type LeadScore,
} from '@/lib/leads/score'
import { cn } from '@/lib/utils'

/**
 * The score card on the lead record: the deterministic score, what produced it,
 * and an optional read from Claude on whether the number fits the lead.
 *
 * The rule-based score is always the one shown large and the one the list sorts
 * by. Claude's assessment sits beside it as a second opinion and is not stored —
 * it is a prompt to look again, not a new number of record.
 */

type ScoreInsight = {
  adjustedScore: number
  direction: 'raise' | 'lower' | 'confirm'
  rationale: string
  factors: string[]
}

const DIRECTION_COPY: Record<ScoreInsight['direction'], string> = {
  raise: 'Reads higher than the rules suggest',
  lower: 'Reads lower than the rules suggest',
  confirm: 'Agrees with the rule-based score',
}

const bandAccent = {
  hot: 'text-destructive',
  warm: 'text-stage-work-text',
  cool: 'text-blue',
  cold: 'text-muted-foreground',
}

export function LeadScoreCard({
  leadId,
  score,
  leadStatus,
  className,
}: {
  leadId: string
  score: LeadScore
  leadStatus: string | null | undefined
  className?: string
}) {
  const token = useAccessToken()
  const [insight, setInsight] = useState<ScoreInsight | null>(null)
  const [loading, setLoading] = useState(false)
  const active = leadScoreIsActive(leadStatus)

  const askClaude = async () => {
    if (!token) return
    setLoading(true)
    try {
      const result = await apiRequest<{ insight: ScoreInsight }>(
        `/api/admin/leads/${leadId}/score-insight`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
        'Could not assess this lead',
      )
      setInsight(result.insight)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not assess this lead')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section
      aria-label="Lead score"
      className={cn('rounded-lg border border-border bg-card p-4', className)}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Lead score</h3>
        <span className="text-[11px] text-muted-foreground">
          {active ? 'Likelihood to hire' : 'Closed — kept for review'}
        </span>
      </div>

      <p className={cn('mt-3 text-2xl font-semibold tabular-nums', active ? bandAccent[score.band] : 'text-muted-foreground')}>
        {score.score}
        <span className="ml-1 text-sm font-normal text-muted-foreground">/ 100</span>
        <span className="ml-2 text-sm font-medium">{leadScoreBandLabel(score.band)}</span>
      </p>

      <ul className="mt-3 space-y-1.5">
        {score.components.map(component => {
          const share = component.max === 0 ? 0 : Math.round((component.points / component.max) * 100)
          return (
            <li key={component.key} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className={component.points > 0 ? 'text-foreground' : 'text-muted-foreground'}>
                  {component.label}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {component.points}/{component.max}
                </span>
              </div>
              <div
                aria-hidden
                className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={cn('h-full transition-[width]', component.points > 0 ? 'bg-brand-teal' : 'bg-transparent')}
                  style={{ width: `${share}%` }}
                />
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{component.reason}</p>
            </li>
          )
        })}
      </ul>

      <div className="mt-4 border-t border-border pt-3">
        {insight ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium">
              {DIRECTION_COPY[insight.direction]}
              <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
                Claude: {insight.adjustedScore}/100
              </span>
            </p>
            {insight.rationale && (
              <p className="text-[11px] text-muted-foreground">{insight.rationale}</p>
            )}
            {insight.factors.length > 0 && (
              <ul className="flex flex-wrap gap-1">
                {insight.factors.map(factor => (
                  <li
                    key={factor}
                    className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {factor}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10px] text-muted-foreground">
              An advisory read on the record above. The score of record stays {score.score}.
            </p>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading || !token}
            onClick={askClaude}
          >
            <Sparkles aria-hidden className="h-3.5 w-3.5" />
            {loading ? 'Reading the record…' : 'Ask Claude to sanity-check'}
          </Button>
        )}
      </div>
    </section>
  )
}
