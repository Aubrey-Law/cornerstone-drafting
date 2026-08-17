import { Badge } from '@/components/ui/badge'
import { invoiceStatusPresentation, type Invoice } from '@/lib/billing/invoices'
import { cn } from '@/lib/utils'

/**
 * Sibling of BillingStatusBadge with the same tone vocabulary, plus `void`.
 * Overdue outranks the stored status, so a late invoice reads "Overdue" rather
 * than "Sent" — the thing you need to act on is the thing you see.
 */
const statusClasses = {
  neutral: 'border-border bg-muted text-muted-foreground',
  invoiced: 'border-blue-strong-border bg-blue-bg text-blue',
  partial: 'border-stage-work/30 bg-stage-work-bg text-stage-work-text',
  paid: 'border-green/30 bg-green-bg text-green',
  overdue: 'border-destructive/30 bg-red-bg text-destructive',
  void: 'border-border bg-muted text-muted-foreground line-through',
}

export function InvoiceStatusBadge({
  invoice,
  overdue,
  className,
}: {
  invoice: Pick<Invoice, 'status'>
  overdue: boolean
  className?: string
}) {
  const presentation = invoiceStatusPresentation(invoice, overdue)
  return (
    <Badge variant="outline" className={cn(statusClasses[presentation.tone], className)}>
      {presentation.label}
    </Badge>
  )
}
