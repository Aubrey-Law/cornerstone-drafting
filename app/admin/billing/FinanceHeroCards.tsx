'use client'

import { FileClock, ReceiptText, TrendingUp, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { BillingSnapshot } from '@/lib/billing/types'
import { money, trend, type Trend } from './financeFormat'

function TrendLine({ value, caption }: { value: Trend; caption: string }) {
  if (value.percent === null) {
    return <p className="text-xs text-muted-foreground">{caption}</p>
  }
  return (
    <p className="text-xs text-muted-foreground">
      <span className={value.positive ? 'font-medium text-green' : 'font-medium text-destructive'}>
        {value.label}
      </span>
      {' '}
      {caption}
    </p>
  )
}

function HeroCard({
  icon: Icon,
  label,
  children,
  action,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  label: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardContent className="flex h-full min-w-0 flex-col px-4 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md border border-border bg-muted">
              <Icon className="size-3.5 text-muted-foreground" aria-hidden />
            </span>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
          </div>
          {action}
        </div>
        <div className="mt-3 min-w-0 flex-1">{children}</div>
      </CardContent>
    </Card>
  )
}

/**
 * The figures strip. Log payment and Add charge used to live inside the
 * Outstanding card; they are the page's primary verbs, so they sit in the page
 * header now and this is purely a readout.
 */
export function FinanceHeroCards({ snapshot }: { snapshot: BillingSnapshot }) {
  const collected = trend(snapshot.collectedMonth.deltaPercent)
  const costs = trend(snapshot.costsMonth.deltaPercent, { goodWhenUp: false })

  return (
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <HeroCard icon={Wallet} label="Outstanding">
        <p className="text-3xl font-semibold tabular-nums">{money(snapshot.outstanding.amount)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {snapshot.outstanding.openCount} open item{snapshot.outstanding.openCount === 1 ? '' : 's'}
          {snapshot.outstanding.overdueAmount > 0
            ? ` · ${money(snapshot.outstanding.overdueAmount)} past due`
            : ''}
        </p>
      </HeroCard>

      <HeroCard icon={TrendingUp} label="Collected this month">
        <p className="text-3xl font-semibold tabular-nums">{money(snapshot.collectedMonth.amount)}</p>
        <div className="mt-2">
          <TrendLine
            value={collected}
            caption={
              collected.percent === null
                ? `No collections in the prior month`
                : 'compared to last month'
            }
          />
        </div>
      </HeroCard>

      <HeroCard icon={ReceiptText} label="Costs billed">
        <p className="text-3xl font-semibold tabular-nums">{money(snapshot.costsMonth.amount)}</p>
        <div className="mt-2">
          <TrendLine
            value={costs}
            caption={
              costs.percent === null
                ? 'No costs billed in the prior month'
                : 'compared to last month'
            }
          />
        </div>
      </HeroCard>

      <HeroCard
        icon={FileClock}
        label="Pending invoices"
        action={
          snapshot.pendingInvoices.overdueCount > 0 ? (
            <Badge variant="outline" className="border-destructive/30 bg-red-bg text-micro text-destructive">
              {snapshot.pendingInvoices.overdueCount} overdue
            </Badge>
          ) : undefined
        }
      >
        <p className="text-3xl font-semibold tabular-nums">{money(snapshot.pendingInvoices.amount)}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {snapshot.pendingInvoices.count} item{snapshot.pendingInvoices.count === 1 ? '' : 's'} waiting to be invoiced
          {snapshot.pendingInvoices.overdueAmount > 0
            ? ` · ${money(snapshot.pendingInvoices.overdueAmount)} already past due`
            : ''}
        </p>
      </HeroCard>
    </div>
  )
}
