import { TrendingDown, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { BillingSnapshot } from '@/lib/billing/types'
import { money } from './financeFormat'

/**
 * Six months of collections as a bar chart. Bars are sized against the tallest
 * month so a quiet stretch still reads, and every bar keeps a 4% floor so an
 * empty month is visible as an empty month rather than as nothing at all.
 */
export function CollectionsTrendCard({
  trend: collections,
}: {
  trend: BillingSnapshot['collectionsTrend']
}) {
  const points = collections.points
  const peak = Math.max(...points.map(point => point.amount), 1)
  const delta = collections.deltaPercent
  const rising = delta !== null && delta >= 0
  const TrendIcon = rising ? TrendingUp : TrendingDown

  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardHeader className="border-b border-border py-3">
        <CardTitle className="text-sm">Collections</CardTitle>
        <p className="text-xs text-muted-foreground">Last 6 months</p>
      </CardHeader>
      <CardContent className="flex h-full flex-col px-4 py-4">
        <ul className="flex flex-1 items-end gap-2">
          {points.map(point => (
            <li key={point.month} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                {point.amount > 0 ? money(point.amount) : '—'}
              </span>
              <span
                className="w-full rounded-md bg-primary/85"
                style={{ height: `${Math.max(4, Math.round((point.amount / peak) * 96))}px` }}
                aria-hidden
              />
              <span className="text-xs text-muted-foreground">
                <span className="sr-only">{money(point.amount)} collected in </span>
                {point.label}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-border pt-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            {delta === null ? (
              'No collections in the prior month'
            ) : (
              <>
                <TrendIcon
                  className={rising ? 'size-4 text-green' : 'size-4 text-destructive'}
                  aria-hidden
                />
                {rising ? 'Up' : 'Down'} {Math.abs(delta)}% this month
              </>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Payments received, newest month last
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
