'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Mail, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CallPhoneLink } from '@/components/phone/CallPhoneLink'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { billingMoney } from '@/lib/billing/metrics'
import { matterFeeProgress, type MatterFeeProgress } from '@/lib/billing/feeProgress'
import type { BillingLedgerRow } from '@/lib/billing/types'
import { formatDate } from '@/lib/utils'
import type { PipelineMatter } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'
import type { MatterPlanMirror } from '@/lib/matter/planMirror'
import type { MatterEstateSnapshot } from '@/lib/assets/matterEstateSnapshot'

const CARD = 'rounded-lg border bg-card px-4 py-3.5'
const LABEL = 'text-xs font-semibold uppercase tracking-wider text-muted-foreground'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '')).toUpperCase()
}

const wholeDollars = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)

export interface OverviewPerson {
  role: 'Client' | 'Spouse'
  name: string | null
  dob: string | null
  email: string | null
  phone: string | null
}

/** The client, plus the spouse when the client is married — never stale spouse data otherwise. */
export function overviewPeople(matter: PipelineMatter): OverviewPerson[] {
  const people: OverviewPerson[] = [{
    role: 'Client', name: matter.client_name, dob: matter.client_dob, email: matter.client_email, phone: matter.client_phone,
  }]
  if (matter.marital_status?.trim().toLowerCase() === 'married' && matter.spouse_name?.trim()) {
    people.push({ role: 'Spouse', name: matter.spouse_name, dob: matter.spouse_dob, email: matter.spouse_email, phone: matter.spouse_phone })
  }
  return people
}

export function PersonSummaryCard({ person }: { person: OverviewPerson }) {
  const name = person.name?.trim() || 'Not recorded'
  return (
    <section aria-label={`${person.role}: ${name}`} className={`${CARD} flex flex-col gap-1.5`}>
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
          {initials(person.name ?? '')}
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate font-semibold">{name}</p>
          <p className="text-xs text-muted-foreground">
            {person.role}{person.dob ? ` · DOB ${formatDate(person.dob)}` : ''}
          </p>
        </div>
      </div>
      {person.email && (
        <p className="flex min-w-0 items-center gap-2 text-compact text-foreground/80">
          <Mail aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <a className="truncate hover:underline" href={`mailto:${person.email}`}>{person.email}</a>
        </p>
      )}
      {person.phone && (
        <p className="flex items-center gap-2 text-compact text-foreground/80">
          <Phone aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <CallPhoneLink phone={person.phone} className="hover:underline" />
        </p>
      )}
    </section>
  )
}

/** Billed and collected from the same ledger the Billing tab reads. */
export function useMatterFeeProgress(matterId: string, details: MatterDetailsRow | null) {
  const token = useAccessToken()
  const [totals, setTotals] = useState<{ billed: number; collected: number } | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    setError(false)
    fetch(`/api/admin/billing/matters/${matterId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      cache: 'no-store',
    })
      .then(async response => {
        const json = await response.json().catch(() => ({})) as { rows?: BillingLedgerRow[] }
        if (!response.ok) throw new Error('billing')
        const rows = json.rows ?? []
        if (!cancelled) setTotals({
          billed: rows.reduce((sum, row) => sum + row.amountBilled, 0),
          collected: rows.reduce((sum, row) => sum + row.collected, 0),
        })
      })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [matterId, token])
  const progress: MatterFeeProgress | null = totals ? matterFeeProgress(details, totals.billed, totals.collected) : null
  return { progress, error }
}

export function FeeSummaryCard({ details, progress, error, onBilling }: {
  details: MatterDetailsRow | null
  progress: MatterFeeProgress | null
  error?: boolean
  onBilling: () => void
}) {
  const stated = details?.flat_fee_amount
  const headline = progress
    ? progress.expected > 0 ? `${billingMoney(progress.expected)} ${progress.isPlan ? 'claim' : 'flat'}` : 'No fee set'
    : typeof stated === 'number' ? `${wholeDollars(stated)} flat` : null
  return (
    <button type="button" onClick={onBilling} aria-label="Fee — open billing"
      className={`${CARD} block w-full text-left transition-colors hover:border-input focus-visible:outline-2 focus-visible:outline-ring`}>
      <span className="mb-2 flex items-baseline justify-between gap-2">
        <span className={LABEL}>Fee</span>
        {headline && <span className="text-xs text-muted-foreground tabular-nums">{headline}</span>}
      </span>
      <span className="block h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Share of the fee collected"
        aria-valuenow={progress?.percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
        <span className="block h-full rounded-full bg-success" style={{ width: `${progress?.percent ?? 0}%` }} />
      </span>
      <span className="mt-1.5 flex justify-between gap-2 text-xs text-muted-foreground tabular-nums">
        {progress ? <>
          <span>{billingMoney(progress.collected)} collected</span>
          <span>Balance {billingMoney(progress.balance)}</span>
        </> : <span>{error ? 'Billing could not be loaded' : 'Loading billing…'}</span>}
      </span>
    </button>
  )
}

export function PlanSummaryCard({ plan, estate, onEdit }: { plan: MatterPlanMirror; estate: MatterEstateSnapshot; onEdit: () => void }) {
  const trustee = plan.fiduciaries.find(item => item.key === 'trustee_slots')
  const trustees = trustee ? [trustee.primary, trustee.successor].filter(Boolean).join(' → ') : ''
  const hasPlan = Boolean(plan.trustName || trustees || estate.assetCount > 0)
  return (
    <section aria-labelledby="overview-plan-heading" className={CARD}>
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h2 id="overview-plan-heading" className={LABEL}>Plan</h2>
        <Button variant="link" size="sm" className="h-auto p-0" onClick={onEdit}>Edit</Button>
      </div>
      {hasPlan ? <>
        {plan.trustName && <p className="font-semibold">{plan.trustName}</p>}
        {trustees && <p className="text-compact text-muted-foreground">Trustees: {trustees}</p>}
        {estate.assetCount > 0 && (
          <p className="text-compact text-muted-foreground tabular-nums">
            Gross estate {wholeDollars(estate.grossEstateEstimate)} · {estate.assetCount} asset{estate.assetCount === 1 ? '' : 's'}
          </p>
        )}
      </> : <p className="text-compact text-muted-foreground">Plan details have not been recorded yet.</p>}
    </section>
  )
}

/** The Overview's right column: people, plan, fee and a task preview. Facts live in the Details panel. */
export function MatterOverviewSidebar({ matter, details, plan, estate, onPeople, onBilling, tasks, children }: {
  matter: PipelineMatter
  details: MatterDetailsRow | null
  plan: MatterPlanMirror
  estate: MatterEstateSnapshot
  onPeople: () => void
  onBilling: () => void
  tasks?: ReactNode
  children?: ReactNode
}) {
  const fee = useMatterFeeProgress(matter.matter_id, details)
  return (
    <div className="flex flex-col gap-4">
      {overviewPeople(matter).map(person => <PersonSummaryCard key={person.role} person={person} />)}
      <PlanSummaryCard plan={plan} estate={estate} onEdit={onPeople} />
      <FeeSummaryCard details={details} progress={fee.progress} error={fee.error} onBilling={onBilling} />
      {tasks && <section aria-label="Tasks preview" className={CARD}>{tasks}</section>}
      {children}
    </div>
  )
}
