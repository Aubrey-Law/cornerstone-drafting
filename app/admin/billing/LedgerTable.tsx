import Link from 'next/link'
import { EmptyState } from '@/components/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { billingStatusPresentation } from '@/lib/billing/metrics'
import type { BillingLedgerRow } from '@/lib/billing/types'
import { cn } from '@/lib/utils'
import { ReceiptText } from 'lucide-react'

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const statusClasses = {
  neutral: 'border-border bg-muted text-muted-foreground',
  invoiced: 'border-blue-strong-border bg-blue-bg text-blue',
  claim: 'border-stage-active/30 bg-stage-active-bg text-stage-active-text',
  partial: 'border-stage-work/30 bg-stage-work-bg text-stage-work-text',
  paid: 'border-green/30 bg-green-bg text-green',
  overdue: 'border-destructive/30 bg-red-bg text-destructive',
}
export function LedgerTable({
  rows,
  onLogPayment,
  onInvoice,
}: {
  rows: BillingLedgerRow[]
  onLogPayment: (row: BillingLedgerRow) => void
  onInvoice: (row: BillingLedgerRow) => void
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
      <Table className="min-w-[760px]">
        <TableHeader>
          <TableRow>
            <TableHead>Client / matter</TableHead>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">Billed</TableHead>
            <TableHead className="text-right">Collected</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Age</TableHead>
            <TableHead className="text-right"><span className="sr-only">Action</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(row => {
            const presentation = billingStatusPresentation(row)
            return (
              <TableRow key={row.id}>
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
                <TableCell className="text-right tabular-nums">{MONEY.format(row.amountBilled / 100)}</TableCell>
                <TableCell className="text-right tabular-nums">{MONEY.format(row.collected / 100)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{MONEY.format(row.balance / 100)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={statusClasses[presentation.tone]}>
                    {presentation.label}
                  </Badge>
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
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
