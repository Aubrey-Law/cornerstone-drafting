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
  partial = false,
  selected,
  onLogPayment,
  onInvoice,
  onBillMatter,
  onToggleRow,
  onToggleAll,
  onEdit,
  onDelete,
}: {
  partial?: boolean
  rows: BillingLedgerRow[]
  /** Ids ticked for bulk delete, keyed by billing item id. */
  selected: Record<string, boolean>
  onLogPayment: (row: BillingLedgerRow) => void
  /** Submits a legal plan claim to the carrier. Never a client invoice. */
  onInvoice: (row: BillingLedgerRow) => void
  /** Opens the composer pre-filled with this matter's uninvoiced charges. */
  onBillMatter: (row: BillingLedgerRow) => void
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

  // Grouped in first-appearance order, so the ledger's own sort (open first,
  // then oldest) still decides which client you see at the top.
  const groups: { matterId: string; clientName: string; balance: number; rows: BillingLedgerRow[] }[] = []
  const groupIndex = new Map<string, number>()
  for (const row of rows) {
    const at = groupIndex.get(row.matterId)
    if (at === undefined) {
      groupIndex.set(row.matterId, groups.length)
      groups.push({ matterId: row.matterId, clientName: row.clientName, balance: row.balance, rows: [row] })
    } else {
      groups[at].rows.push(row)
      groups[at].balance += row.balance
    }
  }

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[940px]">
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
            <TableHead>Invoice</TableHead>
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
          {groups.flatMap(group => [
            // A matter with several charges gets a subtotal line, so "this
            // client owes $3,240" is readable without adding three rows up by
            // hand. Its checkbox selects the whole matter, which is exactly the
            // selection batch invoicing wants.
            ...(group.rows.length > 1 ? [(
              <TableRow key={`group-${group.matterId}`} className="bg-muted/40">
                <TableCell className="pl-4">
                  <Checkbox
                    checked={group.rows.every(row => selected[row.id])}
                    onCheckedChange={checked =>
                      group.rows.forEach(row => onToggleRow(row.id, checked === true))}
                    aria-label={`Select all ${group.rows.length} ${partial ? 'shown ' : ''}charges for ${group.clientName}`}
                  />
                </TableCell>
                <TableCell colSpan={5} className="text-xs font-medium">
                  {group.clientName} · {group.rows.length} charges
                </TableCell>
                <TableCell className="text-right text-xs font-semibold tabular-nums">
                  {billingMoney(group.balance)}
                </TableCell>
                <TableCell colSpan={4} className="pr-4 text-xs text-muted-foreground">
                  {partial ? 'shown charges subtotal' : 'matter total'}
                </TableCell>
              </TableRow>
            )] : []),
            ...group.rows.map(row => (
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
                <TableCell className="whitespace-nowrap">
                  {row.invoiceId ? (
                    /* A draft has no number yet, but it still has a page — and
                       that page is where it is edited, issued or discarded. */
                    <Link
                      href={`/admin/billing/invoices/${row.invoiceId}`}
                      className="text-xs font-medium hover:text-primary hover:underline"
                    >
                      {row.invoiceNumber ?? 'Draft'}
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
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
                  {/* A plan claim is billed to the carrier, so it gets its own
                      verb and never reaches the client invoice composer. */}
                  {row.kind === 'plan_claim' && row.status === 'to_invoice' ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto min-h-11 px-0"
                      aria-label={`Submit claim for ${row.clientName}`}
                      onClick={() => onInvoice(row)}
                    >
                      Submit claim
                    </Button>
                  ) : row.status === 'to_invoice' ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto min-h-11 px-0"
                      aria-label={`Bill ${row.clientName}`}
                      onClick={() => onBillMatter(row)}
                    >
                      Bill this matter
                    </Button>
                  ) : row.kind === 'plan_claim' && row.status === 'claim_submitted' ? (
                    <Button asChild variant="link" size="sm" className="h-auto min-h-11 px-0">
                      <Link href={`/admin/matters/${row.matterId}`} aria-label={`View claim for ${row.clientName}`}>
                        View claim
                      </Link>
                    </Button>
                  ) : row.balance > 0 && row.invoiceNumber && row.invoiceId ? (
                    /* Money for an issued invoice is recorded against the
                       invoice, not the charge — logging it twice is the one way
                       the two ledgers could disagree. */
                    <Button asChild variant="link" size="sm" className="h-auto min-h-11 px-0">
                      <Link
                        href={`/admin/billing/invoices/${row.invoiceId}`}
                        aria-label={`Open invoice ${row.invoiceNumber} to record payment`}
                      >
                        Pay on invoice
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
            )),
          ])}
        </TableBody>
      </Table>
    </div>
  )
}
