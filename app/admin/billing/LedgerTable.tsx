import Link from 'next/link'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { BillingStatusBadge } from '@/components/billing/BillingStatusBadge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { billingMoney } from '@/lib/billing/metrics'
import type { BillingLedgerRow } from '@/lib/billing/types'
import { cn } from '@/lib/utils'
import { Pencil, ReceiptText, Trash2 } from 'lucide-react'

export function LedgerTable({
  rows,
  selected,
  onLogPayment,
  onInvoice,
  onToggleRow,
  onToggleAll,
  onEdit,
  onDelete,
}: {
  rows: BillingLedgerRow[]
  /** Ids ticked for bulk delete, keyed by billing item id. */
  selected: Record<string, boolean>
  onLogPayment: (row: BillingLedgerRow) => void
  onInvoice: (row: BillingLedgerRow) => void
  onToggleRow: (id: string, checked: boolean) => void
  /** Selects or clears every row currently in view, not the whole ledger. */
  onToggleAll: (checked: boolean) => void
  onEdit: (row: BillingLedgerRow) => void
  onDelete: (rows: BillingLedgerRow[]) => void
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={ReceiptText}
        title="No billing items in this view"
        description="Try another filter, search term, or collection month."
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[820px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 pl-4">
              <Checkbox
                checked={rows.every(row => selected[row.id])}
                onCheckedChange={checked => onToggleAll(checked === true)}
                aria-label="Select all billing items in view"
              />
            </TableHead>
            <TableHead>Client / matter</TableHead>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">Billed</TableHead>
            <TableHead className="text-right">Collected</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Age</TableHead>
            <TableHead className="text-right"><span className="sr-only">Action</span></TableHead>
            <TableHead className="w-20 pr-4"><span className="sr-only">Edit or delete</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(row => {
            return (
              <TableRow key={row.id}>
                <TableCell className="pl-4">
                  <Checkbox
                    checked={Boolean(selected[row.id])}
                    onCheckedChange={checked => onToggleRow(row.id, checked === true)}
                    aria-label={`Select ${row.clientName} — ${row.label}`}
                  />
                </TableCell>
                <TableCell>
                  <Link
                    href={`/admin/matters/${row.matterId}`}
                    className="font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {row.clientName}
                  </Link>
                  <p className="text-xs text-muted-foreground">{row.matterNumber ?? 'No matter number'}</p>
                </TableCell>
                <TableCell className="max-w-52 whitespace-normal">{row.label}</TableCell>
                <TableCell className="text-right tabular-nums">{billingMoney(row.amountBilled)}</TableCell>
                <TableCell className="text-right tabular-nums">{billingMoney(row.collected)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{billingMoney(row.balance)}</TableCell>
                <TableCell>
                  <BillingStatusBadge row={row} />
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right tabular-nums text-muted-foreground',
                    row.overdue && 'font-semibold text-destructive',
                  )}
                  title={row.invoicedAt ? `Invoiced ${row.invoicedAt.slice(0, 10)}` : undefined}
                >
                  {row.status === 'paid' ? '—' : `${row.ageDays}d`}
                </TableCell>
                <TableCell className="text-right">
                  {row.status === 'to_invoice' ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto min-h-11 px-0"
                      aria-label={`Send invoice for ${row.clientName}`}
                      onClick={() => onInvoice(row)}
                    >
                      Send invoice
                    </Button>
                  ) : row.kind === 'plan_claim' && row.status === 'claim_submitted' ? (
                    <Button asChild variant="link" size="sm" className="h-auto min-h-11 px-0">
                      <Link href={`/admin/matters/${row.matterId}`} aria-label={`View claim for ${row.clientName}`}>
                        View claim
                      </Link>
                    </Button>
                  ) : row.balance > 0 ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto min-h-11 px-0"
                      aria-label={`Log payment for ${row.clientName}`}
                      onClick={() => onLogPayment(row)}
                    >
                      Log payment
                    </Button>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap pr-4 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-foreground"
                    aria-label={`Edit ${row.label} for ${row.clientName}`}
                    onClick={() => onEdit(row)}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${row.label} for ${row.clientName}`}
                    onClick={() => onDelete([row])}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
