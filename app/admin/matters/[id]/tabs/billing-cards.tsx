'use client'

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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1.5">
                <FieldLabel>Claim amount</FieldLabel>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  className="h-9 text-right tabular-nums"
                  key={String(details?.claim_amount ?? '')}
                  defaultValue={details?.claim_amount ?? ''}
                  onBlur={event => void onSaveField(
                    'claim_amount',
                    event.target.value ? Number(event.target.value) : null,
                  )}
                />
              </label>
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
  const stated = isPlan ? details?.claim_amount : details?.flat_fee_amount
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
export function buildCloseOutGates(details: MatterDetailsRow | null): CloseOutGate[] {
  const isPlan = isLegalPlanBilling(details?.billing_type)
  const stamp = (value: string | null | undefined) =>
    value ? formatFirmDate(value) : 'Not recorded'

  return [
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
}

export function CloseOutCard({
  details,
  onSaveField,
  onCloseMatter,
  closing,
  alreadyClosed,
}: {
  details: MatterDetailsRow | null
  onSaveField: SaveDetailField
  onCloseMatter: () => void
  closing: boolean
  alreadyClosed: boolean
}) {
  const gates = buildCloseOutGates(details)
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
            All four have to be true before this matter can close.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
