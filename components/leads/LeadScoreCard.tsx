'use client'

import { useState } from 'react'
import { ChevronDown, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { apiRequest } from '@/lib/clientApi'
import {
  leadScoreBandLabel,
  leadScoreGaps,
  leadScoreIsActive,
  type LeadScore,
} from '@/lib/leads/score'
import type { LeadEditableField } from '@/lib/leads/details'
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

/** At most this many gaps: a bare lead has five, and five asks is nagging. */
const MAX_GAPS = 3

export function LeadScoreCard({
  leadId,
  score,
  leadStatus,
  onFillField,
  onIntent,
  /**
   * The pipeline step the next-action banner is already showing. The gap it
   * covers is dropped, so a card under "Quote the engagement fee" does not
   * also say "Quote the fee".
   */
  coveredByNextAction,
  className,
}: {
  leadId: string
  score: LeadScore
  leadStatus: string | null | undefined
  onFillField?: (field: LeadEditableField) => void
  onIntent?: (intent: string) => void
  coveredByNextAction?: LeadEditableField | null
  className?: string
}) {
  const token = useAccessToken()
  const [insight, setInsight] = useState<ScoreInsight | null>(null)
  const [loading, setLoading] = useState(false)
  const [factorsOpen, setFactorsOpen] = useState(false)
  const active = leadScoreIsActive(leadStatus)

  // What the reader would have scanned the list for: the factors actually
  // carrying the score, richest first. Only answered ones — the hedges for
  // unasked questions (4 for unset urgency, 2 for an unrecorded source) score
  // points but say nothing about the lead, and headlining "Urgency not set"
  // would be worse than saying nothing.
  // Only offered where something can be done about them, and only while the
  // lead is still in play — a lost lead's blank fee is not a task.
  const gaps = active && (onFillField || onIntent)
    ? leadScoreGaps(score)
      .filter(gap => !(gap.field && gap.field === coveredByNextAction))
      .slice(0, MAX_GAPS)
    : []

  const drivers = score.components
    .filter(component => component.available && component.points > 0)
    .sort((left, right) => right.points - left.points)
    .slice(0, 2)
  const summary = drivers.length > 0
    ? drivers.map(driver => driver.reason).join(' · ')
    : 'Nothing scored yet — no intake, meeting or contact recorded'

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
      {/*
        The band reads the share of what this lead could earn, not of 100 — a
        lead with no fee quoted is not judged on a question nobody has asked it
        yet. Saying so here keeps a "57 · Hot" from looking like a mistake.
      */}
      {score.attainable < 100 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {score.percent}% of the {score.attainable} points on offer so far —{' '}
          {score.components.filter(component => !component.available).length} not yet asked
        </p>
      )}

      {gaps.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-[11px] font-medium text-muted-foreground">What would raise this score</p>
          <ul className="mt-1.5 space-y-1">
            {gaps.map(gap => (
              <li key={gap.key}>
                <button
                  type="button"
                  onClick={() => {
                    if (gap.field && onFillField) onFillField(gap.field)
                    else if (gap.intent && onIntent) onIntent(gap.intent)
                  }}
                  disabled={gap.field ? !onFillField : !onIntent}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
                >
                  <span className="min-w-0 truncate">{gap.label}</span>
                  <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
                    +{gap.points}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Eight factors, each with a bar and a sentence, is most of a side panel
        for a number the reader usually agrees with at a glance. Collapsed, the
        card answers "why" in one line and gives the breakdown back on demand.
      */}
      <Collapsible open={factorsOpen} onOpenChange={setFactorsOpen} className="mt-3">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-md py-1 text-left hover:opacity-90">
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {factorsOpen ? `All ${score.components.length} factors` : summary}
          </span>
          <ChevronDown
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform [[data-state=open]_&]:rotate-180"
          />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <ul className="mt-2 space-y-1.5">
            {score.components.map(component => {
              const share = component.max === 0 ? 0 : Math.round((component.points / component.max) * 100)
              return (
                <li key={component.key} className="text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className={component.points > 0 ? 'text-foreground' : 'text-muted-foreground'}>
                      {component.label}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {component.available ? `${component.points}/${component.max}` : 'not asked'}
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
        </CollapsibleContent>
      </Collapsible>

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
