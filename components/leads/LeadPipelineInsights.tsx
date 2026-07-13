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

function currency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

export function LeadPipelineInsights({ leads }: { leads: LeadInsightRow[] }) {
  const open = leads.filter(lead => (lead.lead_status ?? 'lead') === 'lead')
  const staleBefore = Date.now() - 7 * 86_400_000
  const needsAttention = open.filter(lead => {
    const latest = lead.last_activity_at ?? lead.updated_at ?? lead.created_at
    return lead.lead_urgency === 'high' || !latest || Date.parse(latest) < staleBefore
  }).length
  const agreementsPending = open.filter(lead => lead.engagement_sent_at && !lead.engagement_signed_at).length
  const awaitingIntake = open.filter(lead => !lead.intake_completed_at).length
  const quotedPipeline = open.reduce((total, lead) => total + (lead.engagement_fee_quoted ?? 0), 0)

  const insights = [
    { label: 'Open leads', value: String(open.length), detail: `${awaitingIntake} awaiting intake`, icon: UsersRound },
    { label: 'Needs attention', value: String(needsAttention), detail: 'High urgency or quiet 7+ days', icon: AlertCircle },
    { label: 'Agreements pending', value: String(agreementsPending), detail: 'Sent, not yet signed', icon: FileClock },
    { label: 'Quoted pipeline', value: currency(quotedPipeline), detail: 'Open lead fees', icon: CircleDollarSign },
  ]

  return (
    <section aria-label="Pipeline insights" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {insights.map(({ label, value, detail, icon: Icon }) => (
        <div key={label} className="rounded-lg border bg-card p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          </div>
          <p className="mt-1 text-xl font-semibold tracking-tight">{value}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>
        </div>
      ))}
    </section>
  )
}
