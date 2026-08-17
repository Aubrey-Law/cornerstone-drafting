'use client'

import { useEffect, useMemo, useState, type RefObject } from 'react'
import { AlertTriangle, ReceiptText } from 'lucide-react'
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
import {
  invoiceTermLabels,
  invoiceTerms,
  planBatchInvoices,
  resolveDueDate,
  type InvoiceTerm,
} from '@/lib/billing/invoices'
import type { BillingLedgerRow } from '@/lib/billing/types'

const termDays: Record<InvoiceTerm, number> = {
  due_on_receipt: 0,
  net_15: 15,
  net_30: 30,
  net_60: 60,
}

/**
 * Shows exactly which invoices a ledger selection will produce before creating
 * any of them.
 *
 * Batch billing is the one action here that can create a dozen client-facing
 * documents from a single click, so it commits nothing until you have seen the
 * grouping — and it is equally explicit about what it will leave behind, since
 * a silently dropped charge is a charge that never gets billed.
 */
export function BatchInvoiceDialog({
  open,
  onOpenChange,
  rows,
  today,
  saving,
  returnFocusRef,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The current selection, in ledger order. */
  rows: BillingLedgerRow[]
  today: string
  saving: boolean
  returnFocusRef: RefObject<HTMLElement | null>
  onConfirm: (input: {
    itemIds: string[]
    issueDate: string
    dueInDays: number
    terms: string | null
  }) => Promise<void>
}) {
  const [issueDate, setIssueDate] = useState(today)
  const [term, setTerm] = useState<InvoiceTerm>('net_30')

  useEffect(() => {
    if (!open) return
    setIssueDate(today)
    setTerm('net_30')
  }, [open, today])

  // The same pure planner the route uses, so the preview cannot disagree with
  // what actually gets created.
  const { groups, skipped } = useMemo(() => planBatchInvoices(rows), [rows])
  const total = groups.reduce((sum, group) => sum + group.subtotalCents, 0)
  const dueDate = resolveDueDate(issueDate, term)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(90dvh,42rem)] overflow-y-auto sm:max-w-xl"
        onCloseAutoFocus={event => {
          if (!returnFocusRef.current) return
          event.preventDefault()
          returnFocusRef.current.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {groups.length === 1
              ? 'Create 1 invoice'
              : `Create ${groups.length} invoices`}
          </DialogTitle>
          <DialogDescription>
            One invoice per matter. They are created as drafts so you can review
            each before it goes out.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="batch-issue-date">Issue date</Label>
              <Input
                id="batch-issue-date"
                type="date"
                value={issueDate}
                onChange={event => setIssueDate(event.target.value)}
                className="min-h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="batch-terms">Payment terms</Label>
              <Select value={term} onValueChange={value => setTerm(value as InvoiceTerm)}>
                <SelectTrigger id="batch-terms" className="min-h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {invoiceTerms.map(value => (
                    <SelectItem key={value} value={value}>{invoiceTermLabels[value]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Due {dueDate}</p>
            </div>
          </div>

          {groups.length === 0 ? (
            <p
              role="status"
              className="rounded-md border border-amber-border bg-amber-bg px-3 py-2 text-sm text-amber"
            >
              Nothing in this selection can be invoiced.
            </p>
          ) : (
            <div className="rounded-md border border-border">
              <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                Will create
              </p>
              <ul className="divide-y divide-border">
                {groups.map(group => (
                  <li key={group.matterId} className="flex items-center gap-3 px-3 py-2.5">
                    <ReceiptText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{group.clientName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {group.chargeCount} charge{group.chargeCount === 1 ? '' : 's'}
                      </span>
                    </span>
                    <span className="tabular-nums text-sm">{moneyExact(group.subtotalCents)}</span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-3 bg-muted/40 px-3 py-2.5">
                  <span className="text-sm font-medium">Total to bill</span>
                  <span className="tabular-nums text-sm font-semibold">{moneyExact(total)}</span>
                </li>
              </ul>
            </div>
          )}

          {skipped.length > 0 && (
            <div className="rounded-md border border-amber-border bg-amber-bg px-3 py-2">
              <p className="flex items-center gap-2 text-xs font-medium text-amber">
                <AlertTriangle className="size-3.5" aria-hidden />
                Will skip
              </p>
              <ul className="mt-1 space-y-0.5">
                {skipped.map((skip, index) => (
                  <li key={`${skip.matterId}-${index}`} className="text-xs text-amber">
                    {skip.clientName} — {skip.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving || groups.length === 0}
            onClick={() => void onConfirm({
              itemIds: groups.flatMap(group => group.itemIds),
              issueDate,
              dueInDays: termDays[term],
              terms: null,
            })}
          >
            {saving
              ? 'Creating…'
              : groups.length === 1 ? 'Create 1 draft' : `Create ${groups.length} drafts`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
