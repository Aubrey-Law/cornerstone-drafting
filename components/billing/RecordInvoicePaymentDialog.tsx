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
import { moneyExact } from '@/app/admin/billing/financeFormat'
import { billingPaymentMethods, type BillingPaymentMethod } from '@/lib/billing/types'
import type { InvoiceDetail } from '@/lib/billing/invoices'

const methodLabels: Record<BillingPaymentMethod, string> = {
  check: 'Check',
  card: 'Card',
  ach: 'ACH',
  plan_eft: 'Plan EFT',
  cash: 'Cash',
}

/**
 * Records one payment against a whole invoice.
 *
 * Separate from LogPaymentDialog, which targets a single charge: this one shows
 * how the money will be spread across the invoice's charges before it is
 * committed, so the split is never a surprise after the fact. The allocation
 * shown here mirrors the oldest-charge-first rule the RPC applies.
 */
export function RecordInvoicePaymentDialog({
  open,
  onOpenChange,
  invoice,
  saving,
  returnFocusRef,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice: InvoiceDetail
  saving: boolean
  returnFocusRef: RefObject<HTMLElement | null>
  onSave: (input: {
    amount: number
    method: BillingPaymentMethod
    note: string | null
  }) => Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<BillingPaymentMethod>('check')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    // Paying the balance in full is the common case, so it is the default.
    setAmount((invoice.balance / 100).toFixed(2))
    setMethod('check')
    setNote('')
    setError(null)
  }, [open, invoice.balance])

  const cents = Math.round(Number(amount) * 100)

  /** Mirrors record_invoice_payment: oldest line first, greedily. */
  const allocation = useMemo(() => {
    if (!Number.isSafeInteger(cents) || cents <= 0) return []
    const paidByLine = new Map<string, number>()
    // The dialog only knows invoice-level totals, so spread the collected
    // amount across the lines in the same order the RPC would have.
    let alreadyCollected = invoice.collected
    for (const line of invoice.lines) {
      const applied = Math.min(alreadyCollected, line.amountCents)
      paidByLine.set(line.id, applied)
      alreadyCollected -= applied
    }

    let remaining = cents
    const rows: { description: string; amount: number }[] = []
    for (const line of invoice.lines) {
      if (remaining <= 0) break
      const open = line.amountCents - (paidByLine.get(line.id) ?? 0)
      if (open <= 0) continue
      const apply = Math.min(remaining, open)
      rows.push({ description: line.description, amount: apply })
      remaining -= apply
    }
    return rows
  }, [cents, invoice.collected, invoice.lines])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!Number.isSafeInteger(cents) || cents <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    if (cents > invoice.balance) {
      setError(`That is more than the ${moneyExact(invoice.balance)} still open on this invoice.`)
      return
    }
    setError(null)
    await onSave({ amount: cents, method, note: note.trim() || null })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(90dvh,40rem)] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={event => {
          if (!returnFocusRef.current) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
      >
        <form onSubmit={event => void submit(event)}>
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              Invoice {invoice.number} · {moneyExact(invoice.balance)} open
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-5">
            <div className="space-y-2">
              <Label htmlFor="invoice-payment-amount">Amount</Label>
              <Input
                id="invoice-payment-amount"
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
              <Label htmlFor="invoice-payment-method">Method</Label>
              <Select
                value={method}
                onValueChange={value => setMethod(value as BillingPaymentMethod)}
              >
                <SelectTrigger id="invoice-payment-method" className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {billingPaymentMethods.map(value => (
                    <SelectItem key={value} value={value}>{methodLabels[value]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invoice-payment-note">Note (optional)</Label>
              <Input
                id="invoice-payment-note"
                value={note}
                onChange={event => setNote(event.target.value)}
                maxLength={500}
                className="min-h-11"
                placeholder="e.g. Check 1042"
              />
            </div>

            {allocation.length > 1 && (
              <div className="rounded-md border border-border bg-muted px-3 py-2">
                <p className="text-xs font-medium">This payment will be applied to</p>
                <ul className="mt-1 space-y-0.5">
                  {allocation.map((row, index) => (
                    <li key={index} className="flex justify-between gap-3 text-xs text-muted-foreground">
                      <span className="min-w-0 truncate">{row.description}</span>
                      <span className="tabular-nums">{moneyExact(row.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Record payment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
