import Link from 'next/link'
import { ReceiptText } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { InvoiceStatusBadge } from '@/components/billing/InvoiceStatusBadge'
import { moneyExact } from '@/app/admin/billing/financeFormat'
import { invoicePayerLabels, type Invoice } from '@/lib/billing/invoices'
import { formatFirmDate } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface InvoiceListRowView extends Invoice {
  collected: number
  balance: number
  overdue: boolean
  daysPastDue: number
}

function InvoiceNextAction({ invoice }: { invoice: InvoiceListRowView }) {
  const detailHref = `/admin/billing/invoices/${invoice.id}`
  if (invoice.kind === 'credit_note') {
    return (
      <Button asChild variant="link" size="sm" className="h-auto min-h-11 px-0">
        <Link href={detailHref} aria-label={`View credit note for ${invoice.clientName}`}>
          View credit note
        </Link>
      </Button>
    )
  }
  if (invoice.status === 'draft') {
    return (
      <Button asChild variant="link" size="sm" className="h-auto min-h-11 px-0">
        <Link href={`${detailHref}/edit`} aria-label={`Continue draft for ${invoice.clientName}`}>
          Continue draft
        </Link>
      </Button>
    )
  }
  if (invoice.overdue && invoice.payer === 'client') {
    return (
      <Button asChild variant="link" size="sm" className="h-auto min-h-11 px-0">
        <Link href={detailHref} aria-label={`Review reminder for ${invoice.clientName}`}>
          Review reminder
        </Link>
      </Button>
    )
  }
  if (invoice.status === 'paid') {
    return (
      <Button asChild variant="link" size="sm" className="h-auto min-h-11 px-0">
        <Link href={detailHref} aria-label={`View paid invoice for ${invoice.clientName}`}>
          View invoice
        </Link>
      </Button>
    )
  }
  if (invoice.balance > 0 && invoice.status !== 'void') {
    return (
      <Button asChild variant="link" size="sm" className="h-auto min-h-11 px-0">
        <Link href={detailHref} aria-label={`Record payment for ${invoice.clientName}`}>
          Record payment
        </Link>
      </Button>
    )
  }
  return (
    <Button asChild variant="link" size="sm" className="h-auto min-h-11 px-0">
      <Link href={detailHref} aria-label={`View invoice for ${invoice.clientName}`}>
        View invoice
      </Link>
    </Button>
  )
}

/**
 * The invoice register. Shared by the Billing page's Invoices tab and the
 * standalone /admin/billing/invoices route so the two cannot drift.
 */
export function InvoiceListTable({ invoices }: { invoices: InvoiceListRowView[] }) {
  if (invoices.length === 0) {
    return (
      <EmptyState
        icon={ReceiptText}
        title="No invoices yet"
        description="Group a matter’s open charges into a bill and send it from here."
        action={
          <Button asChild className="min-h-11">
            <Link href="/admin/billing/invoices/new">New invoice</Link>
          </Button>
        }
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[820px]">
        <TableHeader>
          <TableRow>
            <TableHead className="pl-4">Invoice</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Issued</TableHead>
            <TableHead>Due</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="pr-4 text-right"><span className="sr-only">Next action</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map(invoice => (
            <TableRow key={invoice.id}>
              <TableCell className="pl-4">
                <Link
                  href={`/admin/billing/invoices/${invoice.id}`}
                  className="font-medium text-foreground hover:text-primary hover:underline"
                >
                  {invoice.number ?? 'Draft'}
                </Link>
              </TableCell>
              <TableCell>
                <Link
                  href={`/admin/matters/${invoice.matterId}`}
                  className="hover:text-primary hover:underline"
                >
                  {invoice.clientName}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {invoice.matterNumber ?? 'No matter number'}
                  {invoice.payer !== 'client' && ` · Billed to ${invoicePayerLabels[invoice.payer]}`}
                </p>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {invoice.issueDate ? formatFirmDate(invoice.issueDate) : '—'}
              </TableCell>
              <TableCell
                className={cn(
                  'text-muted-foreground',
                  invoice.overdue && 'font-semibold text-destructive',
                )}
              >
                {invoice.dueDate ? formatFirmDate(invoice.dueDate) : '—'}
                {invoice.overdue && ` · ${invoice.daysPastDue}d late`}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {moneyExact(invoice.subtotalCents)}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {moneyExact(invoice.balance)}
              </TableCell>
              <TableCell>
                <InvoiceStatusBadge invoice={invoice} overdue={invoice.overdue} />
              </TableCell>
              <TableCell className="pr-4 text-right">
                <InvoiceNextAction invoice={invoice} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
