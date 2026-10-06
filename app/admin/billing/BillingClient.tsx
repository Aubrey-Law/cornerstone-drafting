'use client'
import { NavigationReady } from '@/app/admin/components/NavigationTiming'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Banknote, ChevronDown, Download, FileText, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { PageHeader } from '@/components/PageHeader'
import { FilterChip } from '@/components/FilterChip'
import { SearchField } from '@/components/SearchField'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { filterBillingRows } from '@/lib/billing/metrics'
import { planBatchInvoices } from '@/lib/billing/invoices'
import type {
  BillingFilter,
  BillingLedgerRow,
  BillingNudge,
  BillingPaymentMethod,
  BillingSnapshot,
} from '@/lib/billing/types'
import type { LedgerPage } from '@/lib/queries/billing'
import { BillingRail } from './BillingRail'
import { CollectionGoalCard } from './CollectionGoalCard'
import { CollectionsTrendCard } from './CollectionsTrendCard'
import { FinanceHeroCards } from './FinanceHeroCards'
import { LedgerTable } from './LedgerTable'
import { ReceivablesSummaryCard } from './ReceivablesSummaryCard'
import { PlanBillingCard } from './PlanBillingCard'
import { RecentPaymentsCard } from './RecentPaymentsCard'
import { RevenueSourcesCard } from './RevenueSourcesCard'
import { WeeklySnapshotCard } from './WeeklySnapshotCard'
import { LogPaymentDialog } from '@/components/billing/LogPaymentDialog'
import {
  AddChargeDialog,
  editableCharge,
  type AddChargeInput,
  type BillingMatterOption,
} from '@/components/billing/AddChargeDialog'
import { DeleteChargesDialog } from '@/components/billing/DeleteChargesDialog'
import { BatchInvoiceDialog } from '@/components/billing/BatchInvoiceDialog'
import type { InvoiceListRowView } from '@/components/billing/InvoiceListTable'
import { BillingViewNav } from './BillingViewNav'
import { BillingWorkSummary } from './BillingWorkSummary'

const filterLabels: { value: BillingFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'to_invoice', label: 'To invoice' },
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
]

function validFilter(value: string | null): BillingFilter {
  return value === 'all' || value === 'to_invoice' || value === 'overdue' || value === 'paid'
    ? value
    : 'open'
}

export default function BillingClient({
  initialSnapshot,
  loadError,
  weekStart,
  matterOptions,
  pagination, bankDeposits,
}: {
  initialSnapshot: BillingSnapshot
  loadError: string | null
  weekStart: string
  matterOptions: BillingMatterOption[]
  invoices: InvoiceListRowView[]
  pagination?: LedgerPage
  bankDeposits?: ReactNode
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const routeQuery = searchParams.toString()
  const token = useAccessToken()
  const filter = validFilter(searchParams.get('filter'))
  const search = searchParams.get('search') ?? ''
  const [searchDraft, setSearchDraft] = useState(search)
  const month = /^\d{4}-\d{2}$/.test(searchParams.get('month') ?? '')
    ? searchParams.get('month')!
    : initialSnapshot.selectedMonth
  const view = searchParams.get('tab') === 'insights' ? 'reports' : 'work'
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentItemId, setPaymentItemId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [chargeOpen, setChargeOpen] = useState(false)
  const [chargeSaving, setChargeSaving] = useState(false)
  const [editingCharge, setEditingCharge] = useState<BillingLedgerRow | null>(null)
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({})
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([])
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchSaving, setBatchSaving] = useState(false)
  const batchOpenerRef = useRef<HTMLElement | null>(null)
  const [deleting, setDeleting] = useState(false)
  const paymentOpenerRef = useRef<HTMLElement | null>(null)
  const chargeOpenerRef = useRef<HTMLElement | null>(null)
  const deleteOpenerRef = useRef<HTMLElement | null>(null)
  const recordOpenerRef = useRef<HTMLButtonElement | null>(null)

  const rows = useMemo(
    () => pagination ? initialSnapshot.rows : filterBillingRows(initialSnapshot.rows, filter, searchDraft, month),
    [filter, initialSnapshot.rows, month, pagination, searchDraft],
  )
  // Only what the current filter shows can be acted on, so a selection left
  // behind by another filter never quietly widens a delete.
  const selection = useMemo(
    () => rows.filter(row => selectedRows[row.id]),
    [rows, selectedRows],
  )
  /**
   * A selection spanning several matters becomes several invoices — one each,
   * since an invoice belongs to exactly one matter. The dialog previews the
   * split before anything is created.
   */
  const batchPlan = useMemo(() => planBatchInvoices(selection), [selection])
  const batchGroupCount = batchPlan.groups.length
  const invoiceableCount = batchPlan.groups.reduce((sum, g) => sum + g.chargeCount, 0)

  const editingInput = useMemo(
    () => (editingCharge ? editableCharge(editingCharge) : undefined),
    [editingCharge],
  )
  const matterIdsWithLegalFee = useMemo(
    () => initialSnapshot.rows
      .filter(row => row.kind === 'flat_fee')
      .map(row => row.matterId),
    [initialSnapshot.rows],
  )
  const localCounts = useMemo(() => ({
    all: initialSnapshot.rows.length,
    to_invoice: filterBillingRows(initialSnapshot.rows, 'to_invoice', '', month).length,
    open: initialSnapshot.rows.filter(row => row.balance > 0).length,
    overdue: initialSnapshot.rows.filter(row => row.overdue).length,
    paid: filterBillingRows(initialSnapshot.rows, 'paid', '', month).length,
  }), [initialSnapshot.rows, month])

  const counts=pagination?.counts ?? localCounts

  function setUrl(next: Partial<{ filter: BillingFilter; search: string; month: string; tab: string }>) {
    const params = new URLSearchParams(routeQuery)
    params.delete('page')
    if (next.tab !== undefined) {
      if (next.tab === 'ledger') params.delete('tab')
      else params.set('tab', next.tab)
    }
    const nextFilter = next.filter ?? filter
    const nextSearch = next.search ?? search
    const nextMonth = next.month ?? month
    if (nextFilter === 'open') params.delete('filter')
    else params.set('filter', nextFilter)
    if (nextSearch) params.set('search', nextSearch)
    else params.delete('search')
    params.set('month', nextMonth)
    const query = params.toString()
    router.replace(`/admin/billing${query ? `?${query}` : ''}`, { scroll: false })
  }

  useEffect(() => {
    setSearchDraft(search)
  }, [search])

  useEffect(() => {
    if (searchDraft === search) return
    const timer = window.setTimeout(() => setUrl({ search: searchDraft }), 300)
    return () => window.clearTimeout(timer)
    // setUrl is derived from the same route state represented by these values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, month, routeQuery, search, searchDraft])

  function headers(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }

  async function downloadAccountingCsv() {
    try {
      const response = await fetch(`/api/admin/billing/export?month=${month}`, { headers: headers() })
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? 'Export failed')
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `cornerstone-accounting-${month}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not export billing data')
    }
  }

  async function send(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
    const response = await fetch(path, {
      method,
      headers: headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const json = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new Error(json.error ?? 'Billing update failed')
  }

  async function request(path: string, body?: unknown) {
    await send(path, 'POST', body)
  }

  /**
   * Opens the composer for a matter with its uninvoiced charges pre-selected.
   * The ids ride in the URL so the composer's first paint already shows the
   * right bill rather than an empty form the user has to rebuild.
   */
  function billMatter(matterId: string) {
    if(pagination) { router.push(`/admin/billing/invoices/new?matterId=${matterId}`); return }
    const billable = initialSnapshot.rows.filter(row =>
      row.matterId === matterId
      && row.kind !== 'plan_claim'
      && !row.invoiceId
      && row.balance > 0)
    const items = billable.map(row => row.id).join(',')
    router.push(
      `/admin/billing/invoices/new?matterId=${matterId}${items ? `&items=${items}` : ''}`,
    )
  }

  function openPayment(row?: BillingLedgerRow, opener?: HTMLElement | null) {
    paymentOpenerRef.current = opener ?? (document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null)
    setPaymentItemId(row?.id ?? initialSnapshot.rows.find(candidate => candidate.balance > 0)?.id ?? null)
    setPaymentOpen(true)
  }

  async function markInvoice(row: BillingLedgerRow) {
    try {
      await request(`/api/admin/billing/items/${row.id}/invoice`)
      toast.success(`Invoice marked sent for ${row.clientName}`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update invoice')
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
      await request(`/api/admin/billing/items/${input.item.id}/payments`, {
        amount: input.amount,
        method: input.method,
        note: input.note,
      })
      setPaymentOpen(false)
      toast.success(`$${(input.amount / 100).toFixed(2)} payment logged`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not log payment')
    } finally {
      setSaving(false)
    }
  }

  function askDelete(targets: BillingLedgerRow[]) {
    if (targets.length === 0) return
    deleteOpenerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
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
      else await request('/api/admin/billing/items/bulk-delete', { ids })
      setPendingDeleteIds([])
      setSelectedRows(current => {
        const next = { ...current }
        for (const id of ids) delete next[id]
        return next
      })
      toast.success(ids.length === 1 ? 'Charge deleted' : `${ids.length} charges deleted`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete charges')
    } finally {
      setDeleting(false)
    }
  }

  function openBatch() {
    batchOpenerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    setBatchOpen(true)
  }

  async function createBatch(input: {
    itemIds: string[]
    issueDate: string
    dueInDays: number
    terms: string | null
  }) {
    setBatchSaving(true)
    try {
      const response = await fetch('/api/admin/billing/invoices/batch', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(input),
      })
      const json = await response.json().catch(() => ({})) as {
        created?: { invoiceId: string }[]
        skipped?: { clientName: string; reason: string }[]
        error?: string
      }
      if (!response.ok) throw new Error(json.error ?? 'Could not create the invoices')

      const created = json.created ?? []
      const skipped = json.skipped ?? []
      setBatchOpen(false)
      setSelectedRows({})
      if (created.length > 0) {
        toast.success(
          created.length === 1
            ? 'Draft invoice created'
            : `${created.length} draft invoices created`,
        )
      }
      // Anything the database refused is surfaced, never swallowed — a charge
      // dropped quietly is a charge that never gets billed.
      if (skipped.length > 0) {
        toast.warning(
          `${skipped.length} skipped: ${skipped.map(s => `${s.clientName} (${s.reason})`).join('; ')}`,
        )
      }
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the invoices')
    } finally {
      setBatchSaving(false)
    }
  }

  function openCharge(opener?: HTMLElement | null) {
    chargeOpenerRef.current = opener ?? (document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null)
    setEditingCharge(null)
    setChargeOpen(true)
  }

  function openEdit(row: BillingLedgerRow) {
    chargeOpenerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
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
        await request('/api/admin/billing/items', first)
      } else {
        // One request so the set saves together or not at all.
        await request('/api/admin/billing/items/bulk-create', {
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
      router.refresh()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : editing ? 'Could not update charge'
            : inputs.length === 1 ? 'Could not add charge' : 'Could not add charges',
      )
    } finally {
      setChargeSaving(false)
    }
  }

  async function dismissNudge(nudge: BillingNudge) {
    try {
      await request('/api/admin/billing/nudges/dismiss', {
        nudgeKey: nudge.key,
        weekStart,
      })
      toast.success('Billing follow-up dismissed for this week')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not dismiss follow-up')
    }
  }

  /**
   * Escalates with age the way a person would: a gentle note in the first
   * fortnight, firmer through six weeks, final after that.
   */
  function reminderTone(description: string): 'friendly' | 'firm' | 'final' {
    const days = Number(description.match(/(\d+) days past due/)?.[1] ?? 0)
    return days > 45 ? 'final' : days > 14 ? 'firm' : 'friendly'
  }

  async function actOnNudge(nudge: BillingNudge) {
    // Billing a matter is composing an invoice, so hand off to the composer
    // with its open charges already selected.
    if (nudge.kind === 'bill') {
      billMatter(nudge.matterId)
      return
    }

    // A plan claim is submitted to MetLife or LegalEASE, never invoiced to the
    // client, so it keeps the per-item carrier path.
    if (nudge.kind === 'claim_submit' && nudge.itemId) {
      const row = initialSnapshot.rows.find(candidate => candidate.id === nudge.itemId)
      if (row) await markInvoice(row)
      return
    }

    // A real, branded reminder with the invoice attached and the send recorded
    // — this replaced a `mailto:` that opened an empty message.
    if (nudge.kind === 'reminder' && nudge.invoiceId) {
      try {
        await request(`/api/admin/billing/invoices/${nudge.invoiceId}/reminder`, {
          tone: reminderTone(nudge.description),
          attachInvoice: true,
        })
        toast.success(
          nudge.invoiceNumber
            ? `Reminder for invoice ${nudge.invoiceNumber} sent to ${nudge.clientName}`
            : `Reminder sent to ${nudge.clientName}`,
        )
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not send the reminder')
      }
      return
    }

    const search = nudge.legalPlan === 'metlife' ? 'metlife-claim' : 'legalease'
    await dismissNudge(nudge)
    router.replace(`/admin/works?search=${search}`)
  }

  return (
    <AdminPageShell className="mx-auto w-full max-w-[1440px]">
      <NavigationReady route="Billing" />
      <PageHeader
        title="Billing"
        description="Charges, invoices, payments, and legal plan claims across all matters."
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button ref={recordOpenerRef} type="button" variant="outline" className="min-h-11">
                  Record
                  <ChevronDown className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => openPayment(undefined, recordOpenerRef.current)}>
                  <Banknote className="size-4" aria-hidden />
                  Log payment
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openCharge(recordOpenerRef.current)}>
                  <FileText className="size-4" aria-hidden />
                  Add charge
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button asChild className="min-h-11">
              <Link href="/admin/billing/invoices/new">
                <Plus className="size-4" aria-hidden />
                New invoice
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="More billing actions">
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void downloadAccountingCsv()}>
                  <Download className="size-4" aria-hidden />
                  Export CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {loadError && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-red-bg px-4 py-3 text-sm text-destructive">
          Billing data could not be fully loaded: {loadError}
        </div>
      )}

      <BillingViewNav active={view} />

      {view === 'work' ? (
        <div className="min-w-0 space-y-4">
          <BillingWorkSummary counts={counts} month={month} />
          {pagination && <div className="flex items-center gap-3 text-sm"><span>{pagination.total} matching charges · page {pagination.page}</span>{[pagination.page-1,pagination.page+1].map((page,index)=>{
            const params=new URLSearchParams(searchParams.toString());params.set('page',String(page))
            return <Button key={index} variant="outline" size="sm" disabled={index===0 ? page<1 : pagination.page*pagination.pageSize>=pagination.total} onClick={()=>router.push(`/admin/billing?${params}`)}>{index===0 ? 'Previous' : 'Next'}</Button>
          })}</div>}
          <div className="min-w-0">
            <Card className="min-w-0 gap-0 py-0">
              <CardHeader className="gap-3 border-b border-border py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <CardTitle className="text-sm">Ledger</CardTitle>
                  <SearchField
                    value={searchDraft}
                    onValueChange={setSearchDraft}
                    placeholder="Search clients…"
                    aria-label="Search billing clients"
                    containerClassName="min-h-11 min-w-[14rem] flex-1 sm:max-w-sm"
                  />
                </div>
                <div className="flex flex-wrap gap-2" aria-label="Billing status filter">
                  {filterLabels.map(option => (
                    <FilterChip
                      key={option.value}
                      selected={filter === option.value}
                      count={counts[option.value]}
                      onClick={() => setUrl({ filter: option.value })}
                      className="min-h-11"
                    >
                      {option.label}
                    </FilterChip>
                  ))}
                </div>
                {selection.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {selection.length} selected
                    </span>
                    {invoiceableCount > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={openBatch}
                      >
                        <Plus className="size-4" aria-hidden />
                        {batchGroupCount === 1
                          ? 'Create invoice'
                          : `Create ${batchGroupCount} invoices`}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedRows({})}
                    >
                      Clear selection
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="sm" aria-label="More selected actions">
                          <MoreHorizontal className="size-4" aria-hidden />
                          More
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={deleting}
                          className="text-destructive focus:text-destructive"
                          onSelect={() => askDelete(selection)}
                        >
                          <Trash2 className="size-4" aria-hidden />
                          Delete selected
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </CardHeader>
              <CardContent className="px-0">
                <LedgerTable
                  rows={rows}
                  partial={Boolean(pagination)}
                  selected={selectedRows}
                  onLogPayment={openPayment}
                  onInvoice={row => void markInvoice(row)}
                  onBillMatter={row => billMatter(row.matterId)}
                  onToggleRow={(id, checked) =>
                    setSelectedRows(current => ({ ...current, [id]: checked }))}
                  onToggleAll={checked =>
                    setSelectedRows(checked ? Object.fromEntries(rows.map(row => [row.id, true])) : {})}
                  onEdit={openEdit}
                  onDelete={askDelete}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <div>
              <p className="text-sm font-medium">Reporting period</p>
              <p className="text-xs text-muted-foreground">Monthly collections and costs; annual figures are labeled separately.</p>
            </div>
            <div>
              <label className="sr-only" htmlFor="billing-month">Reporting month</label>
              <Input
                id="billing-month"
                type="month"
                value={month}
                onChange={event => setUrl({ month: event.target.value })}
                className="min-h-11 w-[10.5rem]"
              />
            </div>
          </div>
          <FinanceHeroCards snapshot={initialSnapshot} />
          <div className="grid gap-4 lg:grid-cols-3"><CollectionGoalCard snapshot={initialSnapshot}/><BillingRail snapshot={initialSnapshot} onNudgeAction={nudge=>void actOnNudge(nudge)} onDismiss={nudge=>void dismissNudge(nudge)}/><RecentPaymentsCard payments={initialSnapshot.recentPayments}/></div>
          <div className="grid min-w-0 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            <RevenueSourcesCard revenue={initialSnapshot.revenue} />
            <CollectionsTrendCard trend={initialSnapshot.collectionsTrend} />
            <ReceivablesSummaryCard snapshot={initialSnapshot} />
            <PlanBillingCard snapshot={initialSnapshot} />
            <WeeklySnapshotCard />
            {bankDeposits}
          </div>
        </div>
      )}

      <AddChargeDialog
        open={chargeOpen}
        onOpenChange={open => {
          setChargeOpen(open)
          if (!open) setEditingCharge(null)
        }}
        // An edit stays on its own matter, so the picker gives way to it.
        matterId={editingCharge?.matterId}
        matters={editingCharge ? undefined : matterOptions}
        matterIdsWithLegalFee={matterIdsWithLegalFee}
        editing={editingInput}
        saving={chargeSaving}
        returnFocusRef={chargeOpenerRef}
        onSave={saveCharge}
      />

      <BatchInvoiceDialog
        open={batchOpen}
        onOpenChange={setBatchOpen}
        rows={selection}
        today={new Date().toISOString().slice(0, 10)}
        saving={batchSaving}
        returnFocusRef={batchOpenerRef}
        onConfirm={createBatch}
      />

      <DeleteChargesDialog
        open={pendingDeleteIds.length > 0}
        onOpenChange={open => !open && setPendingDeleteIds([])}
        rows={initialSnapshot.rows.filter(row => pendingDeleteIds.includes(row.id))}
        deleting={deleting}
        returnFocusRef={deleteOpenerRef}
        onConfirm={() => void deleteCharges()}
      />

      <LogPaymentDialog
        searchAll={Boolean(pagination)}
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        rows={initialSnapshot.rows}
        initialItemId={paymentItemId}
        saving={saving}
        returnFocusRef={paymentOpenerRef}
        onSave={savePayment}
      />
    </AdminPageShell>
  )
}
