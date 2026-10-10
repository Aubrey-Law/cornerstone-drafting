'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Pencil, Plus, ReceiptText, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { RecordTabHeader } from '@/components/RecordTabHeader'
import { BillingStatusBadge } from '@/components/billing/BillingStatusBadge'
import { InvoiceStatusBadge } from '@/components/billing/InvoiceStatusBadge'
import { LogPaymentDialog, paymentMethodLabels } from '@/components/billing/LogPaymentDialog'
import {
  AddChargeDialog,
  editableCharge,
  type AddChargeInput,
} from '@/components/billing/AddChargeDialog'
import { DeleteChargesDialog } from '@/components/billing/DeleteChargesDialog'
import { FeeScheduleCard } from '@/components/billing/FeeScheduleCard'
import {
  AttachFeeScheduleDialog,
  type AttachFeeScheduleInput,
} from '@/components/billing/AttachFeeScheduleDialog'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { billingMoney } from '@/lib/billing/metrics'
import type { MatterInvoiceSummary } from '@/lib/billing/invoices'
import type { MatterFeeScheduleView, ServicePackageOption } from '@/lib/billing/schedules'
import type {
  BillingLedgerRow,
  BillingPaymentMethod,
  BillingPlan,
  AddableBillingKind,
} from '@/lib/billing/types'
import { formatFirmDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { MatterDetailsRow } from '@/types/matter-details'
import {
  CloseOutCard,
  FeeTypeCard,
  ProposalPricingCard,
  LegalPlanClaimCard,
  MoneyInCard,
  PlanClaimsCard,
  type SaveDetailField,
} from './billing-cards'
import { TimeEntriesCard } from './TimeEntriesCard'

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
  feeSchedule: MatterFeeScheduleView | null
  milestonesEnabled: boolean
  servicePackages: ServicePackageOption[]
  invoices: MatterInvoiceSummary[]
}

type BillingSection = 'work' | 'arrangement'

function BillingSectionSwitch({
  section,
  onChange,
}: {
  section: BillingSection
  onChange: (section: BillingSection) => void
}) {
  const options: { value: BillingSection; label: string }[] = [
    { value: 'work', label: 'Work' },
    { value: 'arrangement', label: 'Arrangement' },
  ]
  return (
    <div role="group" aria-label="Billing sections" className="flex w-fit items-center rounded-lg bg-muted p-1">
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          aria-pressed={section === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium transition-colors',
            section === option.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function dayOf(iso: string | null): string {
  return iso ? formatFirmDate(iso) : '—'
}

/** Fees, plan claims and costs billed on this matter. */
function FeesChargesCard({
  rows,
  selected,
  onAddCharge,
  onToggleRow,
  onToggleAll,
  onEdit,
  onDelete,
}: {
  rows: BillingLedgerRow[]
  selected: Record<string, boolean>
  onAddCharge: () => void
  onToggleRow: (id: string, checked: boolean) => void
  onToggleAll: (checked: boolean) => void
  onEdit: (row: BillingLedgerRow) => void
  /** Charges to confirm deleting — one row, or the whole selection. */
  onDelete: (rows: BillingLedgerRow[]) => void
}) {
  const billed = rows.reduce((sum, row) => sum + row.amountBilled, 0)
  const collected = rows.reduce((sum, row) => sum + row.collected, 0)
  const balance = rows.reduce((sum, row) => sum + row.balance, 0)
  const selectedRows = rows.filter(row => selected[row.id])
  const allSelected = rows.length > 0 && selectedRows.length === rows.length

  return (
    <Card>
      <CardHeader className="border-b [.border-b]:pb-4">
        <CardTitle className="text-sm">Fees &amp; charges</CardTitle>
        <div className="col-start-2 row-span-2 row-start-1 flex flex-wrap items-center gap-2 self-start justify-self-end">
          {selectedRows.length > 0 && (
            <>
              <span className="text-xs text-muted-foreground">
                {selectedRows.length} selected
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => onDelete(selectedRows)}
              >
                <Trash2 className="size-4" aria-hidden />
                Delete selected
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={onAddCharge}>
            <Plus className="size-4" aria-hidden />
            Add charge
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {rows.length === 0 ? (
          <EmptyState
            className="py-6"
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
          // On a phone the 560px table scrolled sideways and hid the edit and
          // delete buttons off-screen. The status badge now rides in the item
          // cell and Collected drops below sm, so the row fits a phone.
          <div className="overflow-x-auto">
            <Table className="sm:min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={checked => onToggleAll(checked === true)}
                      aria-label="Select all charges"
                    />
                  </TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Collected</TableHead>
                  <TableHead className="w-20 pr-4">
                    <span className="sr-only">Edit or delete</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="pl-4">
                      <Checkbox
                        checked={Boolean(selected[row.id])}
                        onCheckedChange={checked => onToggleRow(row.id, checked === true)}
                        aria-label={`Select ${row.label}`}
                      />
                    </TableCell>
                    <TableCell className="whitespace-normal sm:max-w-64">
                      <span className="font-medium">{row.label}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <BillingStatusBadge row={row} />
                        <span>
                          {row.invoiceId ? (
                            <Link
                              href={row.invoiceNumber
                                ? `/admin/billing/invoices/${row.invoiceId}`
                                : `/admin/billing/invoices/${row.invoiceId}/edit`}
                              className="font-medium text-foreground hover:underline"
                            >
                              {row.invoiceNumber ?? 'Draft invoice'}
                            </Link>
                          ) : row.invoicedAt ? (
                            `${row.status === 'claim_submitted' ? 'Submitted' : 'Invoiced'} ${dayOf(row.invoicedAt)}`
                          ) : (
                            'Not invoiced'
                          )}
                          {row.invoiceId && row.invoicedAt ? ` · ${dayOf(row.invoicedAt)}` : ''}
                          {row.status !== 'paid' && ` · ${row.ageDays}d`}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {billingMoney(row.amountBilled)}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">
                      {billingMoney(row.collected)}
                    </TableCell>
                    <TableCell className="pr-4 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-foreground"
                        aria-label={`Edit ${row.label}`}
                        onClick={() => onEdit(row)}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${row.label}`}
                        onClick={() => onDelete([row])}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="pl-4" colSpan={2}>
                    Total
                    <span className="block text-xs font-normal text-muted-foreground">
                      Balance {billingMoney(balance)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{billingMoney(billed)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums text-green sm:table-cell">
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
            className="py-6"
            title="No payments recorded"
            description={
              canLog
                ? 'Log the first payment once funds arrive.'
                : 'There is no open balance to pay.'
            }
          />
        ) : (
          // Below sm the method moves under the date, so the note has room
          // instead of the table scrolling sideways.
          <div className="overflow-x-auto">
            <Table className="sm:min-w-[520px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Date</TableHead>
                  <TableHead className="hidden sm:table-cell">Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="pr-4">Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map(payment => (
                  <TableRow key={payment.id}>
                    <TableCell className="pl-4 tabular-nums">
                      {dayOf(payment.receivedAt)}
                      <span className="block text-xs text-muted-foreground sm:hidden">
                        {paymentMethodLabels[payment.method]}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {paymentMethodLabels[payment.method]}
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

/** Invoices already composed for this matter. Charges stay in the ledger below. */
function MatterInvoicesCard({
  invoices,
  createHref,
}: {
  invoices: MatterInvoiceSummary[]
  createHref: string
}) {
  return (
    <Card>
      <CardHeader className="border-b [.border-b]:pb-4">
        <CardTitle className="text-sm">Invoices</CardTitle>
        <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
          <Button asChild variant="outline" size="sm">
            <Link href={createHref}>
              <Plus className="size-4" aria-hidden />
              Create invoice
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        {invoices.length === 0 ? (
          <EmptyState
            className="py-6"
            icon={ReceiptText}
            title="No invoices yet"
            description="Group this matter’s open charges into one bill. Payments recorded against an invoice show up here."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table className="sm:min-w-[520px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Invoice</TableHead>
                  <TableHead className="hidden sm:table-cell">Due</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="pr-4 text-right"><span className="sr-only">Open</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map(invoice => {
                  const href = invoice.status === 'draft'
                    ? `/admin/billing/invoices/${invoice.id}/edit`
                    : `/admin/billing/invoices/${invoice.id}`
                  const label = invoice.number ?? 'Draft'
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="pl-4 whitespace-normal">
                        <Link href={href} className="font-medium hover:underline">
                          {label}
                        </Link>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <InvoiceStatusBadge invoice={invoice} overdue={invoice.overdue} />
                          <span className="sm:hidden">
                            {invoice.dueDate ? `Due ${dayOf(invoice.dueDate)}` : 'No due date'}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {invoice.dueDate ? dayOf(invoice.dueDate) : '—'}
                        {invoice.overdue && (
                          <span className="block text-xs font-semibold text-destructive">
                            {invoice.daysPastDue}d late
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {billingMoney(invoice.balance)}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <Button asChild variant="link" size="sm" className="h-auto min-h-11 px-0">
                          <Link href={href} aria-label={`${invoice.status === 'draft' ? 'Continue' : 'Open'} ${label}`}>
                            {invoice.status === 'draft' ? 'Continue' : 'Open'}
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
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
  const [section, setSection] = useState<BillingSection>('work')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentItemId, setPaymentItemId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [chargeOpen, setChargeOpen] = useState(false)
  const [defaultChargeKind, setDefaultChargeKind] = useState<AddableBillingKind>('flat_fee')
  const [chargeSaving, setChargeSaving] = useState(false)
  const [editingCharge, setEditingCharge] = useState<BillingLedgerRow | null>(null)
  const [selectedCharges, setSelectedCharges] = useState<Record<string, boolean>>({})
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([])
  const [deleting, setDeleting] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const paymentOpenerRef = useRef<HTMLElement | null>(null)
  const chargeOpenerRef = useRef<HTMLElement | null>(null)
  const deleteOpenerRef = useRef<HTMLElement | null>(null)
  const scheduleOpenerRef = useRef<HTMLElement | null>(null)

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
        feeSchedule: json.feeSchedule ?? null,
        milestonesEnabled: json.milestonesEnabled ?? false,
        servicePackages: json.servicePackages ?? [],
        invoices: json.invoices ?? [],
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
  const editingInput = useMemo(
    () => (editingCharge ? editableCharge(editingCharge) : undefined),
    [editingCharge],
  )

  function openPayment(row?: BillingLedgerRow) {
    paymentOpenerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setPaymentItemId(row?.id ?? rows.find(candidate => candidate.balance > 0)?.id ?? null)
    setPaymentOpen(true)
  }

  async function send(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
    const response = await fetch(path, {
      method,
      headers: authHeaders,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const json = (await response.json().catch(() => ({}))) as { error?: string }
    if (!response.ok) throw new Error(json.error ?? 'Billing update failed')
  }

  async function post(path: string, body?: unknown) {
    await send(path, 'POST', body)
  }

  function openCharge(kind: AddableBillingKind = 'flat_fee') {
    chargeOpenerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setEditingCharge(null)
    setDefaultChargeKind(kind)
    setChargeOpen(true)
  }

  function openEdit(row: BillingLedgerRow) {
    chargeOpenerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setEditingCharge(row)
    setChargeOpen(true)
  }

  async function saveCharge(inputs: AddChargeInput[]) {
    const editing = editingCharge
    const [first] = inputs
    if (!first) return
    setChargeSaving(true)
    try {
      if (editing) {
        await send(`/api/admin/billing/items/${editing.id}`, 'PATCH', {
          kind: first.kind,
          label: first.label,
          amountBilled: first.amountBilled,
          plan: first.plan,
        })
      } else if (inputs.length === 1) {
        await post('/api/admin/billing/items', first)
      } else {
        // One request so the set saves together or not at all.
        await post('/api/admin/billing/items/bulk-create', {
          matterId: first.matterId,
          charges: inputs.map(({ kind, label, amountBilled, plan }) => ({
            kind, label, amountBilled, plan,
          })),
        })
      }
      setChargeOpen(false)
      setEditingCharge(null)
      toast.success(
        editing ? `${first.label} updated`
          : inputs.length === 1 ? `${first.label} added`
            : `${inputs.length} charges added`,
      )
      await load()
    } catch (saveError) {
      toast.error(
        saveError instanceof Error
          ? saveError.message
          : editing ? 'Could not update charge'
            : inputs.length === 1 ? 'Could not add charge' : 'Could not add charges',
      )
    } finally {
      setChargeSaving(false)
    }
  }

  function openSchedule() {
    scheduleOpenerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setScheduleOpen(true)
  }

  async function attachSchedule(input: AttachFeeScheduleInput) {
    setScheduleSaving(true)
    try {
      await post(`/api/admin/matters/${matterId}/billing-schedule`, input)
      setScheduleOpen(false)
      toast.success('Fee schedule set')
      await load()
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : 'Could not set fee schedule',
      )
    } finally {
      setScheduleSaving(false)
    }
  }

  function askDelete(targets: BillingLedgerRow[]) {
    if (targets.length === 0) return
    deleteOpenerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setPendingDeleteIds(targets.map(target => target.id))
  }

  async function deleteCharges() {
    const ids = pendingDeleteIds
    if (ids.length === 0) return
    setDeleting(true)
    try {
      // The REST delete carries a single charge; the bulk route removes a whole
      // selection in one statement rather than a request per row.
      if (ids.length === 1) await send(`/api/admin/billing/items/${ids[0]}`, 'DELETE')
      else await post('/api/admin/billing/items/bulk-delete', { ids })
      setPendingDeleteIds([])
      setSelectedCharges(current => {
        const next = { ...current }
        for (const id of ids) delete next[id]
        return next
      })
      toast.success(ids.length === 1 ? 'Charge deleted' : `${ids.length} charges deleted`)
      await load()
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : 'Could not delete charges')
    } finally {
      setDeleting(false)
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
  const claimsToSubmit = toInvoice.filter(row => row.kind === 'plan_claim')
  const billableCharges = rows.filter(row =>
    row.kind !== 'plan_claim' && !row.invoiceId && row.balance > 0)
  // Claims not yet on any invoice, for a carrier invoice. Grouped by the first
  // carrier present; a matter billing two carriers invoices them one at a time.
  const invoiceableClaims = rows.filter(row =>
    row.kind === 'plan_claim' && !row.invoiceId && row.balance > 0)
  const claimPlan = invoiceableClaims[0]?.plan ?? null
  const claimsInvoiceHref = claimPlan
    ? `/admin/billing/invoices/new?matterId=${matterId}&items=${invoiceableClaims
      .filter(row => row.plan === claimPlan)
      .map(row => row.id)
      .join(',')}`
    : null
  const billMatterHref = `/admin/billing/invoices/new?matterId=${matterId}`
    + (billableCharges.length > 0 ? `&items=${billableCharges.map(row => row.id).join(',')}` : '')

  return (
    <TabsContent value="billing" className="space-y-4">
      <RecordTabHeader
        title="Billing"
        description={section === 'work'
          ? 'Invoices, charges, and payments on this matter.'
          : 'How this matter is priced: fee type, proposal, and plan details.'}
        actions={<BillingSectionSwitch section={section} onChange={setSection} />}
      />
      {loading && !view ? (
        <div className="space-y-4" aria-busy>
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : error ? (
        <Card className="py-0">
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
        </Card>
      ) : (
        section === 'arrangement' ? (
          <div className="space-y-4">
            <FeeTypeCard details={details} onSaveField={onSaveField} />
            <ProposalPricingCard details={details} onSaveField={onSaveField} />
            <LegalPlanClaimCard
              details={details}
              onSaveField={onSaveField}
              hasLedgerClaim={rows.some(row => row.kind === 'plan_claim')}
              onStartClaim={() => openCharge('plan_claim')}
            />
            {view?.milestonesEnabled && (
              <FeeScheduleCard
                schedule={view.feeSchedule}
                packageCount={view.servicePackages.length}
                onAttach={openSchedule}
              />
            )}
            <TimeEntriesCard matterId={matterId} />
          </div>
        ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[auto_1fr]">
          {/*
            On a wide screen: invoices and the ledger on the left, the balance
            beside them. On a phone the balance comes first, then the ledger,
            then close-out.
          */}
          <div className="space-y-4 lg:col-start-2 lg:row-start-1">
            <MoneyInCard
              details={details}
              onSaveField={onSaveField}
              billed={rows.reduce((sum, row) => sum + row.amountBilled, 0)}
              collected={rows.reduce((sum, row) => sum + row.collected, 0)}
            />
            {(billableCharges.length > 0 || claimsToSubmit.length > 0 || overdue.length > 0) && (
              <Card>
                <CardHeader className="border-b">
                  <CardTitle className="text-sm">Quick actions</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1">
                    {/* Client charges go on one invoice through the composer;
                        a plan claim keeps its own carrier-facing verb. */}
                    {billableCharges.length > 0 && (
                      <li>
                        <Button
                          asChild
                          variant="link"
                          size="sm"
                          className="h-auto min-h-11 w-full justify-start whitespace-normal px-0 text-left"
                        >
                          <Link href={billMatterHref}>
                            Bill this matter — {billableCharges.length} charge
                            {billableCharges.length === 1 ? '' : 's'}
                          </Link>
                        </Button>
                      </li>
                    )}
                    {claimsToSubmit.map(row => (
                      <li key={`invoice-${row.id}`}>
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto min-h-11 w-full justify-start whitespace-normal px-0 text-left"
                          onClick={() => void markInvoice(row)}
                        >
                          Submit claim — {row.label}
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

          <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
            <MatterInvoicesCard invoices={view?.invoices ?? []} createHref={billMatterHref} />
            <FeesChargesCard
              rows={rows}
              selected={selectedCharges}
              onAddCharge={() => openCharge()}
              onToggleRow={(id, checked) =>
                setSelectedCharges(current => ({ ...current, [id]: checked }))}
              onToggleAll={checked =>
                setSelectedCharges(
                  checked ? Object.fromEntries(rows.map(row => [row.id, true])) : {},
                )}
              onEdit={openEdit}
              onDelete={askDelete}
            />
            <PaymentsCard rows={rows} onLogPayment={() => openPayment()} />
          </div>

          <div className="space-y-4 lg:col-start-2 lg:row-start-2">
            <PlanClaimsCard rows={rows} invoiceHref={claimsInvoiceHref} />
            <CloseOutCard
              details={details}
              onSaveField={onSaveField}
              onCloseMatter={() => void onCloseMatter()}
              closing={closing}
              alreadyClosed={alreadyClosed}
              directBalance={rows.filter(row => row.kind !== 'plan_claim').reduce((sum, row) => sum + row.balance, 0)}
              uninvoicedDirectCount={billableCharges.length}
            />
          </div>
        </div>
        )
      )}

      <AddChargeDialog
        open={chargeOpen}
        onOpenChange={open => {
          setChargeOpen(open)
          if (!open) setEditingCharge(null)
        }}
        matterId={matterId}
        matterIdsWithLegalFee={
          rows.some(row => row.kind === 'flat_fee') ? [matterId] : []
        }
        defaultKind={defaultChargeKind}
        defaultPlan={view?.legalPlan ?? 'metlife'}
        editing={editingInput}
        saving={chargeSaving}
        returnFocusRef={chargeOpenerRef}
        onSave={saveCharge}
      />

      <AttachFeeScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        packages={view?.servicePackages ?? []}
        saving={scheduleSaving}
        returnFocusRef={scheduleOpenerRef}
        onSave={attachSchedule}
      />

      <DeleteChargesDialog
        open={pendingDeleteIds.length > 0}
        onOpenChange={open => !open && setPendingDeleteIds([])}
        rows={rows.filter(row => pendingDeleteIds.includes(row.id))}
        deleting={deleting}
        returnFocusRef={deleteOpenerRef}
        onConfirm={() => void deleteCharges()}
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
