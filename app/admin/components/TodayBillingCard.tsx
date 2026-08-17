import Link from 'next/link'
import { ReceiptText } from 'lucide-react'
import type { TodayBilling } from '@/lib/queries/today'

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/**
 * Money worth clearing today: work that is done but unbilled, and invoices
 * that are late.
 *
 * Deliberately two lines and a link each. The Billing page is the finance
 * dashboard; this is a prompt to go there, so it renders nothing at all when
 * there is nothing to act on.
 */
export function TodayBillingCard({ billing }: { billing: TodayBilling }) {
  const overdue = billing.overdueInvoices
  if (billing.unbilledCount === 0 && overdue.length === 0) return null

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <ReceiptText className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold text-foreground">Billing</h2>
      </header>
      <ul className="divide-y divide-border">
        {billing.unbilledCount > 0 && (
          <li>
            <Link
              href="/admin/billing?filter=to_invoice"
              className="block px-3 py-2 text-sm hover:bg-muted/50"
            >
              <span className="font-medium text-foreground">
                {billing.unbilledCount} charge{billing.unbilledCount === 1 ? '' : 's'} to invoice
              </span>
              <span className="block text-xs text-muted-foreground">
                {MONEY.format(billing.unbilledCents / 100)} not yet billed
              </span>
            </Link>
          </li>
        )}
        {overdue.slice(0, 3).map(invoice => (
          <li key={invoice.id}>
            <Link
              href={`/admin/billing/invoices/${invoice.id}`}
              className="block px-3 py-2 text-sm hover:bg-muted/50"
            >
              <span className="font-medium text-foreground">{invoice.clientName}</span>
              <span className="block text-xs text-destructive">
                {invoice.number ? `Invoice ${invoice.number} · ` : ''}
                {MONEY.format(invoice.balanceCents / 100)} · {invoice.daysPastDue} days past due
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {overdue.length > 3 && (
        <Link
          href="/admin/billing?filter=overdue"
          className="block border-t border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          View {overdue.length - 3} more overdue invoice{overdue.length - 3 === 1 ? '' : 's'}
        </Link>
      )}
    </section>
  )
}
