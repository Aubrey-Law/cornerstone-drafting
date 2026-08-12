'use client'

import type { RefObject } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { billingMoney } from '@/lib/billing/metrics'
import type { BillingLedgerRow } from '@/lib/billing/types'

/**
 * Confirms deleting one or more charges, for the matter Billing tab and the
 * firm billing workspace alike.
 *
 * Deleting a charge takes its payments with it, so anything already collected
 * is called out by amount before the button is offered — that is the one part
 * of a deletion the ledger cannot show again afterwards.
 */
export function DeleteChargesDialog({
  open,
  onOpenChange,
  rows,
  deleting,
  returnFocusRef,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Charges about to be deleted. Empty renders nothing. */
  rows: BillingLedgerRow[]
  deleting: boolean
  returnFocusRef: RefObject<HTMLElement | null>
  onConfirm: () => void
}) {
  const many = rows.length !== 1
  const billed = rows.reduce((sum, row) => sum + row.amountBilled, 0)
  const collected = rows.reduce((sum, row) => sum + row.collected, 0)
  const paymentCount = rows.reduce((sum, row) => sum + row.payments.length, 0)
  const noun = `charge${many ? 's' : ''}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onCloseAutoFocus={event => {
          if (!returnFocusRef.current) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            Delete {rows.length} {noun}?
          </DialogTitle>
          <DialogDescription>
            {many
              ? `${billingMoney(billed)} of billed work leaves the ledger.`
              : `${rows[0]?.label ?? 'This charge'} — ${billingMoney(billed)} — leaves the ledger.`}
            {' '}
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {rows.length > 1 && (
          <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
            {rows.map(row => (
              <li key={row.id} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{row.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {billingMoney(row.amountBilled)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {paymentCount > 0 && (
          <p
            role="status"
            className="rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-xs text-amber"
          >
            {billingMoney(collected)} already collected across {paymentCount} payment
            {paymentCount === 1 ? '' : 's'} will be deleted too, and will no longer count
            toward collections.
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={deleting || rows.length === 0}
          >
            {deleting ? 'Deleting…' : `Delete ${rows.length} ${noun}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
