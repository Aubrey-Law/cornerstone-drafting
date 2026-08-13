import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { BillingPaymentMethod, RecentPaymentRow } from '@/lib/billing/types'
import { formatDateTime } from '@/lib/utils'
import { moneyExact } from './financeFormat'

const METHOD_LABELS: Record<BillingPaymentMethod, string> = {
  check: 'Check',
  card: 'Card',
  ach: 'ACH',
  plan_eft: 'Plan EFT',
  cash: 'Cash',
}

export function RecentPaymentsCard({ payments }: { payments: RecentPaymentRow[] }) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b border-border py-3">
        <CardTitle className="text-sm">Recent payments</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border px-0">
        {payments.length === 0 ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">No payments logged yet.</p>
        ) : payments.map(payment => (
          <div key={payment.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <Link
                href={`/admin/matters/${payment.matterId}`}
                className="text-xs font-medium hover:text-primary hover:underline"
              >
                {payment.clientName}
              </Link>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {METHOD_LABELS[payment.method]} · {formatDateTime(payment.receivedAt)}
              </p>
              {/* The note staff typed when logging it, falling back to the charge
                  it paid — the same line the matter Billing tab shows. */}
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {payment.note || payment.label}
              </p>
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-green">
              +{moneyExact(payment.amount)}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
