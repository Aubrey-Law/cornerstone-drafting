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

/** Cards that narrow the table; `open` just clears back to the Open tab. */
export type LeadCardFilter = 'open' | 'attention' | 'agreements'

const STALE_DAYS = 7

export function isOpenLead(lead: LeadInsightRow): boolean {
  return (lead.lead_status ?? 'lead') === 'lead'
}

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
  leads,
  activeFilter = null,
  onToggleFilter,
}: {
  leads: LeadInsightRow[]
  activeFilter?: LeadCardFilter | null
  onToggleFilter?: (filter: LeadCardFilter) => void
}) {
  const open = leads.filter(isOpenLead)
  const attentionCount = open.filter(needsAttention).length
  const agreementsPending = open.filter(hasPendingAgreement).length
  const awaitingIntake = open.filter(lead => !lead.intake_completed_at).length
  const quotedPipeline = open.reduce((total, lead) => total + (lead.engagement_fee_quoted ?? 0), 0)

  const insights: {
    label: string
    value: string
    detail: string
    icon: typeof UsersRound
    filter: LeadCardFilter | null
  }[] = [
    {
      label: 'Open leads',
      value: String(open.length),
      detail: `${awaitingIntake} awaiting intake`,
      icon: UsersRound,
      filter: 'open',
    },
    {
      label: 'Needs attention',
      value: String(attentionCount),
      detail: `High urgency or quiet ${STALE_DAYS}+ days`,
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
            <p className="mt-0.5 text-[11px] text-muted-foreground">
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
            className={`rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/40 ${
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
