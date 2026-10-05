'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { billingMoney } from '@/lib/billing/metrics'
import {
  FIRM_OPTIONAL_SERVICES,
  OPTIONAL_SERVICE_STATUSES,
  parseOptionalServices,
  type OptionalService,
  type OptionalServiceStatus,
} from '@/lib/billing/optionalServices'
import {
  billingPlans as billingPlanList,
  type BillingLedgerRow,
  type BillingPlan,
} from '@/lib/billing/types'
import {
  MATTER_BILLING_TYPE_OPTIONS,
  isLegalPlanBilling,
  legalPlanDisplayName,
  normalizeMatterBillingType,
} from '@/lib/billing/billingType'
import { formatFirmDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { MatterDetailsRow } from '@/types/matter-details'

export type SaveDetailField = (
  field: keyof MatterDetailsRow,
  value: unknown,
) => Promise<void>

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="block text-xs font-medium text-muted-foreground">{children}</span>
}

function dateValue(value: string | null | undefined): string {
  return typeof value === 'string' ? value.slice(0, 10) : ''
}

function DateField({
  label,
  field,
  details,
  onSaveField,
}: {
  label: string
  field: keyof MatterDetailsRow
  details: MatterDetailsRow | null
  onSaveField: SaveDetailField
}) {
  const value = dateValue(details?.[field] as string | null | undefined)
  return (
    <label className="space-y-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Input
        type="date"
        className="h-9"
        key={value}
        defaultValue={value}
        onBlur={event => {
          if (event.target.value !== value) void onSaveField(field, event.target.value || null)
        }}
      />
    </label>
  )
}

/** How this matter is paid. The primary selector — everything else follows it. */
export function FeeTypeCard({
  details,
  onSaveField,
}: {
  details: MatterDetailsRow | null
  onSaveField: SaveDetailField
}) {
  const billingType = normalizeMatterBillingType(details?.billing_type)

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-sm">Fee type</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <FieldLabel>How this matter is paid</FieldLabel>
          <Select
            value={billingType ?? ''}
            onValueChange={value => void onSaveField('billing_type', value)}
          >
            <SelectTrigger className="h-9" aria-label="Fee type"><SelectValue placeholder="Not set" /></SelectTrigger>
            <SelectContent>
              {MATTER_BILLING_TYPE_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="space-y-1.5">
          <FieldLabel>Flat fee</FieldLabel>
          <Input
            type="number"
            min={0}
            step="0.01"
            className="h-9 text-right tabular-nums"
            key={String(details?.flat_fee_amount ?? '')}
            defaultValue={details?.flat_fee_amount ?? ''}
            onBlur={event => void onSaveField(
              'flat_fee_amount',
              event.target.value ? Number(event.target.value) : null,
            )}
          />
        </label>
      </CardContent>
    </Card>
  )
}

/**
 * What the PMPS proposal prints about price, beyond the fee type above: whether
 * the client has been quoted a fee yet, and the optional services offered.
 *
 * Optional services start on the firm's standard list and stay there until
 * someone customizes them; "None offered" is a recorded answer (an empty list),
 * distinct from never having looked (null), so the proposal can tell the two
 * apart.
 */
export function ProposalPricingCard({
  details,
  onSaveField,
}: {
  details: MatterDetailsRow | null
  onSaveField: SaveDetailField
}) {
  const stored = parseOptionalServices(details?.optional_services)
  const [draft, setDraft] = useState<OptionalService[] | null>(null)
  const [saving, setSaving] = useState(false)
  const editing = draft !== null

  const save = async (next: OptionalService[] | null) => {
    setSaving(true)
    try {
      await onSaveField('optional_services', next)
      setDraft(null)
    } finally {
      setSaving(false)
    }
  }

  const update = (index: number, patch: Partial<OptionalService>) =>
    setDraft(current => current?.map((row, i) => (i === index ? { ...row, ...patch } : row)) ?? current)

  const shown = stored ?? [...FIRM_OPTIONAL_SERVICES]

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-sm">Proposal pricing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <DateField label="Fee quoted to client on" field="fee_quoted_date" details={details} onSaveField={onSaveField} />
          <p className="self-end text-xs text-muted-foreground">
            {details?.fee_quoted_date
              ? 'The PMPS agenda notes when the fee was quoted.'
              : 'Not quoted yet — the proposal will be the first written figure the client sees.'}
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FieldLabel>
              Optional services
              {stored === null ? ' — firm standard list' : stored.length === 0 ? ' — none offered' : ''}
            </FieldLabel>
            {!editing && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setDraft(shown.map(row => ({ ...row })))}>
                  Edit
                </Button>
                {stored?.length !== 0 && (
                  <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void save([])}>
                    None offered
                  </Button>
                )}
                {stored !== null && (
                  <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void save(null)}>
                    Use firm standard
                  </Button>
                )}
              </div>
            )}
          </div>

          {editing ? (
            <div className="space-y-2">
              {draft.map((row, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_7rem_8rem_auto]">
                  <Input
                    aria-label="Service"
                    placeholder="Service"
                    className="h-9"
                    value={row.service}
                    onChange={event => update(index, { service: event.target.value })}
                  />
                  <Input
                    aria-label="Description"
                    placeholder="Description"
                    className="h-9"
                    value={row.description}
                    onChange={event => update(index, { description: event.target.value })}
                  />
                  <Input
                    aria-label="Fee"
                    type="number"
                    min={0}
                    step="1"
                    placeholder="Fee"
                    className="h-9 text-right tabular-nums"
                    value={row.fee ?? ''}
                    onChange={event => update(index, { fee: event.target.value === '' ? null : Number(event.target.value) })}
                  />
                  <Select
                    value={row.status}
                    onValueChange={value => update(index, { status: value as OptionalServiceStatus })}
                  >
                    <SelectTrigger className="h-9" aria-label="Status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OPTIONAL_SERVICE_STATUSES.map(status => (
                        <SelectItem key={status} value={status}>{status}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${row.service || 'service'}`}
                    onClick={() => setDraft(current => current?.filter((_, i) => i !== index) ?? current)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDraft(current => [...(current ?? []), { service: '', description: '', fee: null, status: 'Optional' }])}
                >
                  Add service
                </Button>
                <Button type="button" size="sm" disabled={saving} onClick={() => void save(parseOptionalServices(draft) ?? [])}>
                  Save services
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No optional services — the proposal leaves the table out.</p>
          ) : (
            <ul className="divide-y rounded-md border text-sm">
              {shown.map(row => (
                <li key={row.service} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2">
                  <span className="min-w-0">
                    <span className="font-medium">{row.service}</span>
                    {row.description && <span className="block text-xs text-muted-foreground">{row.description}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {row.fee === null ? 'Fee not set' : billingMoney(Math.round(row.fee * 100))}
                    <span className="ml-2 text-xs text-muted-foreground">{row.status}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * One card for everything a plan claim needs: who the plan is, the service
 * window, and the work dates every claim form asks for. Flat-fee matters keep
 * the work dates and never see the claim block.
 */
export function LegalPlanClaimCard({
  details,
  onSaveField,
  hasLedgerClaim,
  onStartClaim,
}: {
  details: MatterDetailsRow | null
  onSaveField: SaveDetailField
  hasLedgerClaim: boolean
  onStartClaim: () => void
}) {
  const isPlan = isLegalPlanBilling(details?.billing_type)
  const planName = legalPlanDisplayName(details?.billing_type)

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-sm">
          {isPlan ? 'Legal plan, claim & work dates' : 'Work dates'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isPlan && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <FieldLabel>Plan</FieldLabel>
              <p className="flex h-9 items-center text-sm font-medium">{planName}</p>
            </div>
            <label className="space-y-1.5">
              <FieldLabel>Member ID</FieldLabel>
              <Input
                className="h-9"
                key={details?.legal_plan_member_id ?? ''}
                defaultValue={details?.legal_plan_member_id ?? ''}
                onBlur={event => void onSaveField('legal_plan_member_id', event.target.value || null)}
              />
            </label>
            <DateField label="Service start" field="legal_plan_service_start" details={details} onSaveField={onSaveField} />
            <DateField label="Service end" field="legal_plan_service_end" details={details} onSaveField={onSaveField} />
            <label className="space-y-1.5">
              <FieldLabel>Client status</FieldLabel>
              <Input
                className="h-9"
                placeholder="e.g. active member"
                key={details?.client_status ?? ''}
                defaultValue={details?.client_status ?? ''}
                onBlur={event => void onSaveField('client_status', event.target.value || null)}
              />
            </label>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DateField label="Work started" field="work_started_date" details={details} onSaveField={onSaveField} />
          <DateField label="Work finished" field="work_finished_date" details={details} onSaveField={onSaveField} />
        </div>

        {isPlan && (
          <>
            {/* The claim amount is the ledger's plan_claim row, shown on Money in.
                It used to be hand-typed here too, which let a stale figure
                outrank what the firm is actually claiming. */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DateField label="Claim submitted" field="claim_submitted_date" details={details} onSaveField={onSaveField} />
              <DateField label="Reimbursement received" field="reimbursement_received_date" details={details} onSaveField={onSaveField} />
            </div>
            {!hasLedgerClaim && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  This matter is covered by {planName}, but no claim has been added to the ledger.
                </p>
                <Button variant="outline" size="sm" onClick={onStartClaim}>
                  Start a claim
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * What is expected, what has arrived, and the gap. Balance due is derived on
 * every render — storing it would create a second truth that drifts the moment
 * a payment lands.
 */
export function MoneyInCard({
  details,
  onSaveField,
  billed,
  collected,
}: {
  details: MatterDetailsRow | null
  onSaveField: SaveDetailField
  billed: number
  collected: number
}) {
  const isPlan = isLegalPlanBilling(details?.billing_type)
  // A flat fee is quoted before the engagement seeds its ledger row, so the
  // stated figure is the only answer until then. A plan claim has no such
  // window — it exists once it is in the ledger, and the ledger is the answer.
  const stated = isPlan ? null : details?.flat_fee_amount
  const expected = typeof stated === 'number' && Number.isFinite(stated) ? stated : billed
  const balance = expected - collected
  const percent = expected > 0 ? Math.max(0, Math.min(100, Math.round((collected / expected) * 100))) : 100
  const linkSentAt = details?.payment_link_sent_at ?? null

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-sm">Money in</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">{isPlan ? 'Claim amount' : 'Fee amount'}</dt>
            <dd className="tabular-nums">{billingMoney(expected)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">Amount collected</dt>
            <dd className="tabular-nums text-green">{billingMoney(collected)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="font-medium">Balance due</dt>
            <dd className={cn('text-lg font-semibold tabular-nums', balance > 0 && 'text-destructive')}>
              {billingMoney(balance)}
            </dd>
          </div>
        </dl>

        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Share of the expected amount collected"
        >
          <span className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <div className="text-xs text-muted-foreground">
            Payment link{' '}
            {linkSentAt ? `sent ${formatFirmDate(linkSentAt)}` : 'not sent'}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void onSaveField('payment_link_sent_at', new Date().toISOString())}
          >
            {linkSentAt ? 'Mark sent again' : 'Mark link sent'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export interface CloseOutGate {
  key: string
  label: string
  met: boolean
  detail: string
}

/**
 * The four things that must be true before a matter closes. "Close matter"
 * stays disabled until all of them are — a matter closed with an unsubmitted
 * claim is money the firm never collects.
 */
export function buildCloseOutGates(
  details: MatterDetailsRow | null,
  financial?: { directBalance: number; uninvoicedDirectCount: number },
): CloseOutGate[] {
  const isPlan = isLegalPlanBilling(details?.billing_type)
  const stamp = (value: string | null | undefined) =>
    value ? formatFirmDate(value) : 'Not recorded'

  const gates: CloseOutGate[] = [
    {
      key: 'work_finished',
      label: 'Work finished recorded',
      met: Boolean(details?.work_finished_date),
      detail: stamp(details?.work_finished_date),
    },
    {
      key: 'closing_package',
      label: 'Closing package sent',
      met: Boolean(details?.closing_package_sent_date),
      detail: stamp(details?.closing_package_sent_date),
    },
    // A flat-fee matter has no claim to submit, so the claim gates are met by
    // definition rather than blocking close-out forever.
    {
      key: 'claim_submitted',
      label: 'Claim submitted',
      met: !isPlan || Boolean(details?.claim_submitted_date),
      detail: isPlan ? stamp(details?.claim_submitted_date) : 'Not applicable — flat fee',
    },
    {
      key: 'reimbursement_received',
      label: 'Reimbursement received',
      met: !isPlan || Boolean(details?.reimbursement_received_date),
      detail: isPlan ? stamp(details?.reimbursement_received_date) : 'Not applicable — flat fee',
    },
  ]
  if (financial) gates.push({
    key: 'billing_resolved',
    label: 'Client billing resolved',
    met: financial.directBalance === 0 && financial.uninvoicedDirectCount === 0,
    detail: financial.directBalance > 0
      ? `${billingMoney(financial.directBalance)} outstanding`
      : financial.uninvoicedDirectCount > 0
        ? `${financial.uninvoicedDirectCount} charge${financial.uninvoicedDirectCount === 1 ? '' : 's'} still need an invoice`
        : 'No client balance or uninvoiced charges',
  })
  return gates
}

export function CloseOutCard({
  details,
  onSaveField,
  onCloseMatter,
  closing,
  alreadyClosed,
  directBalance,
  uninvoicedDirectCount,
}: {
  details: MatterDetailsRow | null
  onSaveField: SaveDetailField
  onCloseMatter: () => void
  closing: boolean
  alreadyClosed: boolean
  directBalance: number
  uninvoicedDirectCount: number
}) {
  const gates = buildCloseOutGates(details, { directBalance, uninvoicedDirectCount })
  const ready = gates.every(gate => gate.met)

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-sm">Close-out</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {gates.map(gate => (
            <li key={gate.key} className="flex items-start justify-between gap-2 text-sm">
              <span className="flex items-start gap-2">
                <span
                  aria-hidden
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    gate.met ? 'bg-green' : 'bg-muted-foreground/40',
                  )}
                />
                <span>
                  {gate.label}
                  <span className="block text-xs text-muted-foreground">{gate.detail}</span>
                </span>
              </span>
              <span className="sr-only">{gate.met ? 'Done' : 'Outstanding'}</span>
            </li>
          ))}
        </ul>

        <DateField
          label="Closing package sent"
          field="closing_package_sent_date"
          details={details}
          onSaveField={onSaveField}
        />

        <Button
          type="button"
          className="w-full"
          disabled={!ready || closing || alreadyClosed}
          onClick={onCloseMatter}
        >
          {alreadyClosed ? 'Matter closed' : closing ? 'Closing…' : 'Close matter'}
        </Button>
        {!ready && !alreadyClosed && (
          <p className="text-xs text-muted-foreground">
            Resolve every close-out item, including billing, before this matter can close.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

const planCarrierNames: Record<BillingPlan, string> = {
  metlife: 'MetLife',
  legalease: 'LegalEASE',
}

/**
 * This matter's legal plan claims, per carrier: what has been billed to the
 * plan, what it has paid, and what is still to submit. Kept apart from Money
 * in, which is about the client's balance as much as the plan's.
 */
export function PlanClaimsCard({
  rows,
  invoiceHref,
}: {
  rows: BillingLedgerRow[]
  /** Opens the composer with this matter's uninvoiced claims ticked. */
  invoiceHref: string | null
}) {
  const plans = billingPlanList.filter(plan =>
    rows.some(row => row.kind === 'plan_claim' && row.plan === plan))
  if (plans.length === 0) return null

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-sm">Billed to legal plan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {plans.map(plan => {
          const claims = rows.filter(row => row.kind === 'plan_claim' && row.plan === plan)
          const submitted = claims.filter(row => row.status !== 'to_invoice')
          const unsubmitted = claims.filter(row => row.status === 'to_invoice')
          const billed = submitted.reduce((sum, row) => sum + row.amountBilled, 0)
          const reimbursed = claims.reduce((sum, row) => sum + row.collected, 0)
          const owed = submitted.reduce((sum, row) => sum + row.balance, 0)
          return (
            <dl key={plan} aria-label={planCarrierNames[plan]} className="space-y-2 text-sm">
              {plans.length > 1 && <p className="font-medium">{planCarrierNames[plan]}</p>}
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">Billed to {planCarrierNames[plan]}</dt>
                <dd className="tabular-nums">{billingMoney(billed)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">Reimbursed</dt>
                <dd className="tabular-nums text-green">{billingMoney(reimbursed)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="font-medium">Owed by {planCarrierNames[plan]}</dt>
                <dd className={cn('font-semibold tabular-nums', owed > 0 && 'text-amber')}>
                  {billingMoney(owed)}
                </dd>
              </div>
              {unsubmitted.length > 0 && (
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">
                    Not yet submitted · {unsubmitted.length} claim{unsubmitted.length === 1 ? '' : 's'}
                  </dt>
                  <dd className="tabular-nums">
                    {billingMoney(unsubmitted.reduce((sum, row) => sum + row.amountBilled, 0))}
                  </dd>
                </div>
              )}
            </dl>
          )
        })}
        {invoiceHref && (
          <Button asChild variant="outline" size="sm" className="min-h-11 w-full">
            <Link href={invoiceHref}>Invoice claims to the plan</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
