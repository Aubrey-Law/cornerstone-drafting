'use client'

import { AlertCircle, CircleDollarSign, FileClock, UsersRound } from 'lucide-react'

type LeadInsightRow = {
  lead_status: string | null
  intake_completed_at: string | null
  engagement_sent_at: string | null
  engagement_signed_at: string | null
  engagement_fee_quoted: number | null
  lead_urgency: string | null
  created_at: string | null
  updated_at: string | null
  last_activity_at: string | null
}

/**
 * What the cards report. Counted over the whole pipeline in `v_lead_list`
 * rather than over the rows the page happens to hold — the cards are how the
 * reader sees what a filter or a page boundary is hiding, so counting the
 * loaded rows would have made them agree with the list by construction.
 */
export type LeadInsightTotals = {
  open: number
  attention: number
  agreements: number
  awaitingIntake: number
  quotedPipeline: number
}

/** Cards that narrow the table; `open` just clears back to the Open tab. */
export type LeadCardFilter = 'open' | 'attention' | 'agreements'

const STALE_DAYS = 7

export function isOpenLead(lead: LeadInsightRow): boolean {
  return (lead.lead_status ?? 'lead') === 'lead'
}

/**
 * Mirrored by `needs_attention` in `v_lead_list`; the board still asks per row.
 */
export function needsAttention(lead: LeadInsightRow): boolean {
  const latest = lead.last_activity_at ?? lead.updated_at ?? lead.created_at
  return (
    lead.lead_urgency === 'high'
    || !latest
    || Date.parse(latest) < Date.now() - STALE_DAYS * 86_400_000
  )
}

export function hasPendingAgreement(lead: LeadInsightRow): boolean {
  return Boolean(lead.engagement_sent_at) && !lead.engagement_signed_at
}

function currency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

export function LeadPipelineInsights({
  totals,
  activeFilter = null,
  onToggleFilter,
}: {
  totals: LeadInsightTotals
  activeFilter?: LeadCardFilter | null
  onToggleFilter?: (filter: LeadCardFilter) => void
}) {
  const { attention: attentionCount, agreements: agreementsPending, awaitingIntake, quotedPipeline } = totals

  const insights: {
    label: string
    value: string
    detail: string
    icon: typeof UsersRound
    filter: LeadCardFilter | null
  }[] = [
    {
      label: 'Open leads',
      value: String(totals.open),
      detail: `${awaitingIntake} awaiting intake`,
      icon: UsersRound,
      filter: 'open',
    },
    {
      label: 'Needs attention',
      value: String(attentionCount),
      detail: 'Critical, due, client-waiting, or upcoming work',
      icon: AlertCircle,
      filter: 'attention',
    },
    {
      label: 'Agreements pending',
      value: String(agreementsPending),
      detail: 'Sent, not yet signed',
      icon: FileClock,
      filter: 'agreements',
    },
    {
      label: 'Quoted pipeline',
      value: currency(quotedPipeline),
      detail: 'Set the fee when sending the agreement',
      icon: CircleDollarSign,
      filter: null,
    },
  ]

  return (
    <section aria-label="Pipeline insights" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {insights.map(({ label, value, detail, icon: Icon, filter }) => {
        const clickable = Boolean(filter && onToggleFilter)
        const active = filter !== null && filter === activeFilter
        const card = (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
            </div>
            <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
            <p className="mt-0.5 text-micro text-muted-foreground">
              {active ? 'Filtering — click to clear' : detail}
            </p>
          </>
        )
        if (!clickable) {
          return (
            <div key={label} className="rounded-lg border bg-card p-3">
              {card}
            </div>
          )
        }
        return (
          <button
            key={label}
            type="button"
            aria-pressed={active}
            onClick={() => onToggleFilter?.(filter!)}
            className={`rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent ${
              active ? 'border-primary ring-1 ring-primary' : ''
            }`}
          >
            {card}
          </button>
        )
      })}
    </section>
  )
}
