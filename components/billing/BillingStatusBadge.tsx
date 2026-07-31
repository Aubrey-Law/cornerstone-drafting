import { Badge } from '@/components/ui/badge'
import { billingStatusPresentation } from '@/lib/billing/metrics'
import type { BillingLedgerRow } from '@/lib/billing/types'
import { cn } from '@/lib/utils'

/**
 * The billing status pill, shared by the firm ledger and the matter Billing
 * tab. `billingStatusPresentation` already resolves overdue ahead of the
 * workflow status, so an overdue row reads "Overdue".
 */
const statusClasses = {
  neutral: 'border-border bg-muted text-muted-foreground',
  invoiced: 'border-blue-strong-border bg-blue-bg text-blue',
  claim: 'border-stage-active/30 bg-stage-active-bg text-stage-active-text',
  partial: 'border-stage-work/30 bg-stage-work-bg text-stage-work-text',
  paid: 'border-green/30 bg-green-bg text-green',
  overdue: 'border-destructive/30 bg-red-bg text-destructive',
}

export function BillingStatusBadge({
  row,
  className,
}: {
  row: BillingLedgerRow
  className?: string
}) {
  const presentation = billingStatusPresentation(row)
  return (
    <Badge variant="outline" className={cn(statusClasses[presentation.tone], className)}>
      {presentation.label}
    </Badge>
  )
}
