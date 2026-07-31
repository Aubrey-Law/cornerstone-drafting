'use client'

import { useEffect, useMemo, useState, type RefObject } from 'react'
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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
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
  const openRows = useMemo(() => rows.filter(row => row.balance > 0), [rows])
  const [itemId, setItemId] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<BillingPaymentMethod>('check')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const selected = openRows.find(row => row.id === itemId) ?? null

  useEffect(() => {
    if (!open) return
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
