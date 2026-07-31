'use client'

import { useMemo, useRef, useState } from 'react'
import { Download, Plus } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import { PageHeader } from '@/components/PageHeader'
import { FilterChip } from '@/components/FilterChip'
import { SearchField } from '@/components/SearchField'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { billingCsv, filterBillingRows } from '@/lib/billing/metrics'
import type {
  BillingFilter,
  BillingLedgerRow,
  BillingNudge,
  BillingPaymentMethod,
  BillingSnapshot,
} from '@/lib/billing/types'
import { BillingRail } from './BillingRail'
import { KpiRow } from './KpiRow'
import { LedgerTable } from './LedgerTable'
import { LogPaymentDialog } from '@/components/billing/LogPaymentDialog'
import { RevenueTiles } from './RevenueTiles'

const filterLabels: { value: BillingFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
]

function validFilter(value: string | null): BillingFilter {
  return value === 'all' || value === 'overdue' || value === 'paid' ? value : 'open'
}

function downloadCsv(rows: BillingLedgerRow[], month: string) {
  const blob = new Blob([billingCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `cornerstone-billing-${month}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

export default function BillingClient({
  initialSnapshot,
  loadError,
  weekStart,
}: {
  initialSnapshot: BillingSnapshot
  loadError: string | null
  weekStart: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = useAccessToken()
  const filter = validFilter(searchParams.get('filter'))
  const search = searchParams.get('search') ?? ''
  const month = /^\d{4}-\d{2}$/.test(searchParams.get('month') ?? '')
    ? searchParams.get('month')!
    : initialSnapshot.selectedMonth
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentItemId, setPaymentItemId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const paymentOpenerRef = useRef<HTMLElement | null>(null)

  const rows = useMemo(
    () => filterBillingRows(initialSnapshot.rows, filter, search, month),
    [filter, initialSnapshot.rows, month, search],
  )
  const counts = useMemo(() => ({
    all: initialSnapshot.rows.length,
    open: initialSnapshot.rows.filter(row => row.balance > 0).length,
    overdue: initialSnapshot.rows.filter(row => row.overdue).length,
    paid: filterBillingRows(initialSnapshot.rows, 'paid', '', month).length,
  }), [initialSnapshot.rows, month])

  function setUrl(next: Partial<{ filter: BillingFilter; search: string; month: string }>) {
    const params = new URLSearchParams(searchParams.toString())
    const nextFilter = next.filter ?? filter
    const nextSearch = next.search ?? search
    const nextMonth = next.month ?? month
    if (nextFilter === 'open') params.delete('filter')
    else params.set('filter', nextFilter)
    if (nextSearch) params.set('search', nextSearch)
    else params.delete('search')
    if (nextMonth === initialSnapshot.selectedMonth) params.delete('month')
    else params.set('month', nextMonth)
    const query = params.toString()
    router.replace(`/admin/billing${query ? `?${query}` : ''}`, { scroll: false })
  }

  function headers(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }

  async function request(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: 'POST',
      headers: headers(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const json = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new Error(json.error ?? 'Billing update failed')
  }

  function openPayment(row?: BillingLedgerRow) {
    paymentOpenerRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
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

  async function actOnNudge(nudge: BillingNudge) {
    if (nudge.kind === 'invoice' && nudge.itemId) {
      const row = initialSnapshot.rows.find(candidate => candidate.id === nudge.itemId)
      if (row) await markInvoice(row)
      return
    }
    if (nudge.kind === 'reminder' && nudge.itemId) {
      try {
        await request(`/api/admin/billing/items/${nudge.itemId}/reminder`)
        toast.success(`Reminder recorded for ${nudge.clientName}`)
        router.refresh()
        if (nudge.clientEmail) {
          window.location.assign(
            `mailto:${encodeURIComponent(nudge.clientEmail)}?subject=${encodeURIComponent('Payment reminder')}`,
          )
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not record reminder')
      }
      return
    }
    const search = nudge.legalPlan === 'metlife' ? 'metlife-claim' : 'legalease'
    await dismissNudge(nudge)
    router.replace(`/admin/works?search=${search}`)
  }

  return (
    <AdminPageShell className="mx-auto w-full max-w-[1440px]">
      <PageHeader
        title="Billing"
        description={`Fees, legal plan claims, and costs across all matters · ${new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-15T12:00:00Z`))}`}
        actions={
          <>
            <label className="sr-only" htmlFor="billing-month">Collection month</label>
            <Input
              id="billing-month"
              type="month"
              value={month}
              onChange={event => setUrl({ month: event.target.value })}
              className="min-h-11 w-[10.5rem]"
            />
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => downloadCsv(rows, month)}
            >
              <Download className="size-4" aria-hidden />
              Export CSV
            </Button>
            <Button type="button" className="min-h-11" onClick={() => openPayment()}>
              <Plus className="size-4" aria-hidden />
              Log payment
            </Button>
          </>
        }
      />

      {loadError && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-red-bg px-4 py-3 text-sm text-destructive">
          Billing data could not be fully loaded: {loadError}
        </div>
      )}

      <RevenueTiles revenue={initialSnapshot.revenue} />
      <KpiRow snapshot={initialSnapshot} />

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="min-w-0 gap-0 py-0">
          <CardHeader className="gap-3 border-b border-border py-3">
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle className="text-sm">Ledger</CardTitle>
              <SearchField
                value={search}
                onValueChange={value => setUrl({ search: value })}
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
          </CardHeader>
          <CardContent className="px-0">
            <LedgerTable rows={rows} onLogPayment={openPayment} onInvoice={row => void markInvoice(row)} />
          </CardContent>
        </Card>
        <BillingRail
          snapshot={initialSnapshot}
          onNudgeAction={nudge => void actOnNudge(nudge)}
          onDismiss={nudge => void dismissNudge(nudge)}
        />
      </div>

      <LogPaymentDialog
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
