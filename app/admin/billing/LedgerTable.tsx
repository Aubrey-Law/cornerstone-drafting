import Link from 'next/link'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BillingStatusBadge } from '@/components/billing/BillingStatusBadge'
import { ledgerChargeLabel, readyForLabel } from '@/lib/billing/ledgerCopy'
import { billingMoney } from '@/lib/billing/metrics'
import type { BillingLedgerRow } from '@/lib/billing/types'
import { cn } from '@/lib/utils'
import { MoreHorizontal, Pencil, ReceiptText, Trash2 } from 'lucide-react'

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
  const groups: { matterId: string; clientName: string; matterNumber: string | null; balance: number; rows: BillingLedgerRow[] }[] = []
  const groupIndex = new Map<string, number>()
  for (const row of rows) {
    const at = groupIndex.get(row.matterId)
    if (at === undefined) {
      groupIndex.set(row.matterId, groups.length)
      groups.push({
        matterId: row.matterId,
        clientName: row.clientName,
        matterNumber: row.matterNumber,
        balance: row.balance,
        rows: [row],
      })
    } else {
      groups[at].rows.push(row)
      groups[at].balance += row.balance
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Checkbox
          checked={rows.every(row => selected[row.id])}
          onCheckedChange={checked => onToggleAll(checked === true)}
          aria-label="Select all billing items in view"
        />
        <span className="text-xs text-muted-foreground">
          {rows.length} charge{rows.length === 1 ? '' : 's'}
        </span>
      </div>
      <ul className="divide-y divide-border" aria-label="Billing ledger">
        {groups.map(group => (
          <li key={group.matterId}>
            <div className="flex items-center gap-3 bg-muted px-4 py-2.5">
              {group.rows.length > 1 ? (
                <Checkbox
                  checked={group.rows.every(row => selected[row.id])}
                  onCheckedChange={checked =>
                    group.rows.forEach(row => onToggleRow(row.id, checked === true))}
                  aria-label={`Select all ${group.rows.length} ${partial ? 'shown ' : ''}charges for ${group.clientName}`}
                />
              ) : (
                <span className="size-4 shrink-0" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <Link
                  href={`/admin/matters/${group.matterId}?tab=billing`}
                  className="font-medium text-foreground hover:text-primary hover:underline"
                >
                  {group.clientName}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {group.matterNumber ?? 'No matter number'}
                </p>
                {group.rows.length > 1 && (
                  <p className="text-xs text-muted-foreground">
                    {group.clientName} · {group.rows.length} charges
                  </p>
                )}
              </div>
              <p className="text-sm font-semibold tabular-nums">{billingMoney(group.balance)}</p>
            </div>
            <ul>
              {group.rows.map(row => (
                <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                  <Checkbox
                    checked={Boolean(selected[row.id])}
                    onCheckedChange={checked => onToggleRow(row.id, checked === true)}
                    aria-label={`Select ${row.clientName} — ${row.label}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{ledgerChargeLabel(row.label, row.amountBilled)}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <BillingStatusBadge row={row} />
                      {row.invoiceId ? (
                        <Link
                          href={`/admin/billing/invoices/${row.invoiceId}`}
                          className="font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {row.invoiceNumber ?? 'Draft'}
                        </Link>
                      ) : (
                        <span>Not on an invoice</span>
                      )}
                      {row.status !== 'paid' && (
                        <span className={cn(row.overdue && 'font-semibold text-destructive')}>
                          {readyForLabel(row.ageDays)}
                        </span>
                      )}
                    </div>
                  </div>
                  {group.rows.length > 1 && (
                    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                      {billingMoney(row.balance)}
                    </span>
                  )}
                  <LedgerRowAction
                    row={row}
                    onLogPayment={onLogPayment}
                    onInvoice={onInvoice}
                    onBillMatter={onBillMatter}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label={`More actions for ${row.label} for ${row.clientName}`}
                      >
                        <MoreHorizontal className="size-4" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onEdit(row)}>
                        <Pencil className="size-4" aria-hidden />
                        Edit charge
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => onDelete([row])}
                      >
                        <Trash2 className="size-4" aria-hidden />
                        Delete charge
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}

function LedgerRowAction({
  row,
  onLogPayment,
  onInvoice,
  onBillMatter,
}: {
  row: BillingLedgerRow
  onLogPayment: (row: BillingLedgerRow) => void
  onInvoice: (row: BillingLedgerRow) => void
  onBillMatter: (row: BillingLedgerRow) => void
}) {
  if (row.kind === 'plan_claim' && row.status === 'to_invoice') {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-label={`Submit claim for ${row.clientName}`}
        onClick={() => onInvoice(row)}
      >
        Submit claim
      </Button>
    )
  }
  if (row.status === 'to_invoice') {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-label={`Bill ${row.clientName}`}
        onClick={() => onBillMatter(row)}
      >
        Bill
      </Button>
    )
  }
  if (row.kind === 'plan_claim' && row.status === 'claim_submitted') {
    return (
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <Link href={`/admin/matters/${row.matterId}?tab=billing`} aria-label={`View claim for ${row.clientName}`}>
          View claim
        </Link>
      </Button>
    )
  }
  if (row.balance > 0 && row.invoiceNumber && row.invoiceId) {
    return (
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <Link
          href={`/admin/billing/invoices/${row.invoiceId}`}
          aria-label={`Open invoice ${row.invoiceNumber} to record payment`}
        >
          Record payment
        </Link>
      </Button>
    )
  }
  if (row.balance > 0) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-label={`Log payment for ${row.clientName}`}
        onClick={() => onLogPayment(row)}
      >
        Log payment
      </Button>
    )
  }
  return null
}
