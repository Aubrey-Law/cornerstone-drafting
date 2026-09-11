'use client'

import { useEffect, useMemo, useState, useRef, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { BillingLedgerRow, BillingPaymentMethod } from '@/lib/billing/types'

const methodLabels: Record<BillingPaymentMethod, string> = {
  check: 'Check',
  card: 'Card',
  ach: 'ACH',
  plan_eft: 'Plan EFT',
  cash: 'Cash',
}

export function LogPaymentDialog({
  open,
  onOpenChange,
  rows,
  initialItemId,
  saving,
  returnFocusRef,
  onSave,
  searchAll = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  searchAll?: boolean
  rows: BillingLedgerRow[]
  initialItemId: string | null
  saving: boolean
  returnFocusRef: RefObject<HTMLElement | null>
  onSave: (input: {
    item: BillingLedgerRow
    amount: number
    method: BillingPaymentMethod
    note: string | null
  }) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<{ rows: BillingLedgerRow[]; total: number; pageSize: number } | null>(null)
  const [searchError, setSearchError] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  const seeded = useRef(false)
  useEffect(() => {
    if (!open || !searchAll) return
    const abort = new AbortController()
    setSearchLoading(true); setSearchError(false)
    const timer = setTimeout(() => {
      void fetch(`/api/admin/billing/ledger?${new URLSearchParams({ q: query, page: String(page) })}`, { signal: abort.signal })
        .then(async response => { if (!response.ok) throw new Error('Unavailable'); return response.json() })
        .then(data => { if (!abort.signal.aborted) setResult(data) })
        .catch(() => { if (!abort.signal.aborted) setSearchError(true) })
        .finally(() => { if (!abort.signal.aborted) setSearchLoading(false) })
    }, 250)
    return () => { abort.abort(); clearTimeout(timer) }
  }, [open, searchAll, query, page, retry])
  const openRows = useMemo(() => {
    const current = (searchAll && result ? result.rows : rows).filter(row => row.balance > 0)
    const initial = rows.find(row => row.id === initialItemId && row.balance > 0)
    return initial && !current.some(row => row.id === initial.id) ? [initial, ...current] : current
  }, [rows, result, searchAll, initialItemId])
  const [itemId, setItemId] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<BillingPaymentMethod>('check')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const selected = openRows.find(row => row.id === itemId) ?? null

  useEffect(() => {
    if (!open) { seeded.current = false; return }
    if (seeded.current) return
    seeded.current = true
    const next = openRows.find(row => row.id === initialItemId) ?? openRows[0] ?? null
    setItemId(next?.id ?? '')
    setAmount(next ? (next.balance / 100).toFixed(2) : '')
    setMethod('check')
    setNote('')
    setError(null)
  }, [initialItemId, open, openRows])

  function chooseItem(id: string) {
    const row = openRows.find(candidate => candidate.id === id)
    setItemId(id)
    setAmount(row ? (row.balance / 100).toFixed(2) : '')
    setError(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!selected) {
      setError('Choose an open billing item.')
      return
    }
    const cents = Math.round(Number(amount) * 100)
    if (!Number.isSafeInteger(cents) || cents <= 0) {
      setError('Enter a positive payment amount.')
      return
    }
    if (cents > selected.balance) {
      setError('Payment cannot exceed the open balance.')
      return
    }
    setError(null)
    await onSave({
      item: selected,
      amount: cents,
      method,
      note: note.trim() || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(90dvh,36rem)] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={event => {
          if (!returnFocusRef.current) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
      >
        <form onSubmit={event => void submit(event)}>
          <DialogHeader>
            <DialogTitle>Log payment</DialogTitle>
            <DialogDescription>Record a payment received against an open billing item.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-5">
            {searchAll && <div className="space-y-2">
              <Input aria-label="Search all open charges" placeholder="Search all clients, matters, and charges…" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} />
              {searchLoading && <p role="status" className="text-xs">Searching charges…</p>}
              {searchError && <p role="alert" className="text-xs">Charge search failed. <button type="button" className="underline" onClick={() => setRetry(n => n + 1)}>Retry</button></p>}
              {result && <div className="flex items-center gap-2 text-xs"><span>{result.total} matching open charges · page {page}</span><Button type="button" variant="outline" size="sm" disabled={page <= 1 || searchLoading} onClick={() => setPage(n => n - 1)}>Previous</Button><Button type="button" variant="outline" size="sm" disabled={page * result.pageSize >= result.total || searchLoading} onClick={() => setPage(n => n + 1)}>Next</Button></div>}
            </div>}
            <div className="space-y-2">
              <Label htmlFor="billing-item">Billing item</Label>
              <Select value={itemId} onValueChange={chooseItem}>
                <SelectTrigger id="billing-item" aria-label="Billing item" className="min-h-11 w-full">
                  <SelectValue placeholder="Choose an open item" />
                </SelectTrigger>
                <SelectContent>
                  {openRows.map(row => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.clientName} · ${(row.balance / 100).toFixed(2)} open
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-amount">Amount</Label>
              <Input
                id="payment-amount"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={event => setAmount(event.target.value)}
                className="min-h-11 tabular-nums"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-method">Method</Label>
              <Select value={method} onValueChange={value => setMethod(value as BillingPaymentMethod)}>
                <SelectTrigger id="payment-method" className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(methodLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-note">Note <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                id="payment-note"
                value={note}
                onChange={event => setNote(event.target.value)}
                maxLength={500}
                className="min-h-11"
              />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || openRows.length === 0}>
              {saving ? 'Saving…' : 'Save payment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
