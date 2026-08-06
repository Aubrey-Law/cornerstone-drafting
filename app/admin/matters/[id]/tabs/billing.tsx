'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Plus, ReceiptText } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TabsContent } from '@/components/ui/tabs'
import { BillingStatusBadge } from '@/components/billing/BillingStatusBadge'
import { LogPaymentDialog } from '@/components/billing/LogPaymentDialog'
import { AddChargeDialog, type AddChargeInput } from '@/components/billing/AddChargeDialog'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { billingMoney } from '@/lib/billing/metrics'
import type {
  BillingLedgerRow,
  BillingPaymentMethod,
  BillingPlan,
} from '@/lib/billing/types'
import { formatFirmDate } from '@/lib/format'
import type { MatterDetailsRow } from '@/types/matter-details'
import {
  CloseOutCard,
  FeeTypeCard,
  LegalPlanClaimCard,
  MoneyInCard,
  type SaveDetailField,
} from './billing-cards'

interface MatterBillingTabProps {
  matterId: string
  /** False until the tab is first opened, so its data loads lazily. */
  enabled: boolean
  details: MatterDetailsRow | null
  onSaveField: SaveDetailField
  /** Stamps closed_date and moves the matter to the closed stage. */
  onCloseMatter: () => Promise<void>
  closing?: boolean
  alreadyClosed?: boolean
}

interface MatterBillingView {
  rows: BillingLedgerRow[]
  legalPlan: BillingPlan | null
  hasClaim: boolean
}

function dayOf(iso: string | null): string {
  return iso ? formatFirmDate(iso) : '—'
}

/** Fees, plan claims and costs billed on this matter. */
function FeesChargesCard({
  rows,
  onAddCharge,
}: {
  rows: BillingLedgerRow[]
  onAddCharge: () => void
}) {
  const billed = rows.reduce((sum, row) => sum + row.amountBilled, 0)
  const collected = rows.reduce((sum, row) => sum + row.collected, 0)
  const balance = rows.reduce((sum, row) => sum + row.balance, 0)

  return (
    <Card>
      <CardHeader className="border-b [.border-b]:pb-4">
        <CardTitle className="text-sm">Fees &amp; charges</CardTitle>
        <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
          <Button variant="outline" size="sm" onClick={onAddCharge}>
            <Plus className="size-4" aria-hidden />
            Add charge
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {rows.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="Nothing billed yet"
            description="The engagement fee appears here once the agreement is signed. Costs and plan claims can be added now."
            action={
              <Button variant="outline" size="sm" onClick={onAddCharge}>
                <Plus className="size-4" aria-hidden />
                Add charge
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[520px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Item</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead className="pr-4">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-52 whitespace-normal pl-4">
                      <span className="font-medium">{row.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {row.invoicedAt
                          ? `${row.status === 'claim_submitted' ? 'Submitted' : 'Invoiced'} ${dayOf(row.invoicedAt)}`
                          : 'Not invoiced'}
                        {row.status !== 'paid' && ` · ${row.ageDays}d`}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {billingMoney(row.amountBilled)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {billingMoney(row.collected)}
                    </TableCell>
                    <TableCell className="pr-4">
                      <BillingStatusBadge row={row} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-4">
                    Total
                    <span className="block text-xs font-normal text-muted-foreground">
                      Balance {billingMoney(balance)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{billingMoney(billed)}</TableCell>
                  <TableCell className="text-right tabular-nums text-green">
                    {billingMoney(collected)}
                  </TableCell>
                  <TableCell className="pr-4" />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Payments received against this matter, newest first. */
function PaymentsCard({
  rows,
  onLogPayment,
}: {
  rows: BillingLedgerRow[]
  onLogPayment: () => void
}) {
  const payments = rows
    .flatMap(row => row.payments.map(payment => ({ ...payment, label: row.label })))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id.localeCompare(a.id))
  const canLog = rows.some(row => row.balance > 0)

  return (
    <Card>
      <CardHeader className="border-b [.border-b]:pb-4">
        <CardTitle className="text-sm">Payments</CardTitle>
        <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
          <Button size="sm" onClick={onLogPayment} disabled={!canLog}>
            Log payment
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {payments.length === 0 ? (
          <EmptyState
            title="No payments recorded"
            description={
              canLog
                ? 'Log the first payment once funds arrive.'
                : 'There is no open balance to pay.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[520px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Date</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="pr-4">Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map(payment => (
                  <TableRow key={payment.id}>
                    <TableCell className="pl-4 tabular-nums">{dayOf(payment.receivedAt)}</TableCell>
                    <TableCell className="capitalize">
                      {payment.method === 'plan_eft' ? 'Plan EFT' : payment.method}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {billingMoney(payment.amount)}
                    </TableCell>
                    <TableCell className="max-w-52 whitespace-normal pr-4 text-muted-foreground">
                      {payment.note || payment.label}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function MatterBillingTab({
  matterId,
  enabled,
  details,
  onSaveField,
  onCloseMatter,
  closing = false,
  alreadyClosed = false,
}: MatterBillingTabProps) {
  const token = useAccessToken()
  const [view, setView] = useState<MatterBillingView | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentItemId, setPaymentItemId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [chargeOpen, setChargeOpen] = useState(false)
  const [chargeSaving, setChargeSaving] = useState(false)
  const paymentOpenerRef = useRef<HTMLElement | null>(null)
  const chargeOpenerRef = useRef<HTMLElement | null>(null)

  const authHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    [token],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/billing/matters/${matterId}`, {
        headers: authHeaders,
        cache: 'no-store',
      })
      const json = (await response.json().catch(() => ({}))) as
        & Partial<MatterBillingView>
        & { error?: string }
      if (!response.ok) throw new Error(json.error ?? 'Could not load billing')
      setView({
        rows: json.rows ?? [],
        legalPlan: json.legalPlan ?? null,
        hasClaim: json.hasClaim ?? false,
      })
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load billing')
    } finally {
      setLoading(false)
    }
  }, [matterId, authHeaders])

  useEffect(() => {
    if (!enabled) return
    void load()
  }, [enabled, load])

  const rows = view?.rows ?? []

  function openPayment(row?: BillingLedgerRow) {
    paymentOpenerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setPaymentItemId(row?.id ?? rows.find(candidate => candidate.balance > 0)?.id ?? null)
    setPaymentOpen(true)
  }

  async function post(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: 'POST',
      headers: authHeaders,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const json = (await response.json().catch(() => ({}))) as { error?: string }
    if (!response.ok) throw new Error(json.error ?? 'Billing update failed')
  }

  function openCharge() {
    chargeOpenerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setChargeOpen(true)
  }

  async function saveCharge(input: AddChargeInput) {
    setChargeSaving(true)
    try {
      await post('/api/admin/billing/items', input)
      setChargeOpen(false)
      toast.success(`${input.label} added`)
      await load()
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Could not add charge')
    } finally {
      setChargeSaving(false)
    }
  }

  async function markInvoice(row: BillingLedgerRow) {
    try {
      await post(`/api/admin/billing/items/${row.id}/invoice`)
      toast.success(`Invoice marked sent for ${row.label}`)
      await load()
    } catch (updateError) {
      toast.error(updateError instanceof Error ? updateError.message : 'Could not update invoice')
    }
  }

  async function sendReminder(row: BillingLedgerRow) {
    try {
      await post(`/api/admin/billing/items/${row.id}/reminder`)
      toast.success(`Reminder logged for ${row.label}`)
      await load()
    } catch (updateError) {
      toast.error(updateError instanceof Error ? updateError.message : 'Could not log reminder')
    }
  }

  async function savePayment(input: {
    item: BillingLedgerRow
    amount: number
    method: BillingPaymentMethod
    note: string | null
  }) {
    setSaving(true)
    try {
      await post(`/api/admin/billing/items/${input.item.id}/payments`, {
        amount: input.amount,
        method: input.method,
        note: input.note,
      })
      toast.success(`${billingMoney(input.amount)} logged for ${input.item.label}`)
      setPaymentOpen(false)
      await load()
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Could not log payment')
    } finally {
      setSaving(false)
    }
  }

  const toInvoice = rows.filter(row => row.status === 'to_invoice')
  const overdue = rows.filter(row => row.overdue)

  return (
    <TabsContent value="billing" className="space-y-4">
      {loading && !view ? (
        <div className="space-y-4" aria-busy>
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : error ? (
        <EmptyState
          icon={AlertTriangle}
          title="Billing unavailable"
          description={error}
          action={
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            <FeeTypeCard details={details} onSaveField={onSaveField} />
            <LegalPlanClaimCard
              details={details}
              onSaveField={onSaveField}
              hasLedgerClaim={rows.some(row => row.kind === 'plan_claim')}
              onStartClaim={openCharge}
            />
            <FeesChargesCard rows={rows} onAddCharge={openCharge} />
            <PaymentsCard rows={rows} onLogPayment={() => openPayment()} />
          </div>

          <div className="space-y-4">
            <MoneyInCard
              details={details}
              onSaveField={onSaveField}
              billed={rows.reduce((sum, row) => sum + row.amountBilled, 0)}
              collected={rows.reduce((sum, row) => sum + row.collected, 0)}
            />
            <CloseOutCard
              details={details}
              onSaveField={onSaveField}
              onCloseMatter={() => void onCloseMatter()}
              closing={closing}
              alreadyClosed={alreadyClosed}
            />
            {(toInvoice.length > 0 || overdue.length > 0) && (
              <Card>
                <CardHeader className="border-b">
                  <CardTitle className="text-sm">Quick actions</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {toInvoice.map(row => (
                      <li key={`invoice-${row.id}`}>
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto min-h-11 w-full justify-start whitespace-normal px-0 text-left"
                          onClick={() => void markInvoice(row)}
                        >
                          Send invoice for {row.label}
                        </Button>
                      </li>
                    ))}
                    {overdue.map(row => (
                      <li key={`remind-${row.id}`}>
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto min-h-11 w-full justify-start whitespace-normal px-0 text-left"
                          onClick={() => void sendReminder(row)}
                        >
                          Send payment reminder — {row.label} ({row.ageDays}d)
                        </Button>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      <AddChargeDialog
        open={chargeOpen}
        onOpenChange={setChargeOpen}
        matterId={matterId}
        matterIdsWithLegalFee={
          rows.some(row => row.kind === 'flat_fee') ? [matterId] : []
        }
        saving={chargeSaving}
        returnFocusRef={chargeOpenerRef}
        onSave={saveCharge}
      />

      <LogPaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        rows={rows}
        initialItemId={paymentItemId}
        saving={saving}
        returnFocusRef={paymentOpenerRef}
        onSave={savePayment}
      />
    </TabsContent>
  )
}
