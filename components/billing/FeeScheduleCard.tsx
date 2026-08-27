'use client'

import { CalendarClock, Plus } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { billingMoney } from '@/lib/billing/metrics'
import type { FeeMilestoneRow, MatterFeeScheduleView } from '@/lib/billing/schedules'
import { formatFirmDate } from '@/lib/format'

const STATE_LABELS: Record<FeeMilestoneRow['state'], string> = {
  scheduled: 'Scheduled',
  ready: 'Ready to invoice',
  invoiced: 'Invoiced',
  paid: 'Paid',
  waived: 'Waived',
}

const STATE_VARIANTS: Record<
  FeeMilestoneRow['state'],
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  scheduled: 'outline',
  ready: 'default',
  invoiced: 'secondary',
  paid: 'secondary',
  waived: 'outline',
}

/**
 * A matter's agreed fee and the milestones that bill it.
 *
 * Milestones are released by the stage engine, not from here: reaching the
 * triggering stage turns a scheduled milestone into a charge on the ledger
 * below. This card is the record of what is owed and when, so releasing by
 * hand would put the two out of step.
 */
export function FeeScheduleCard({
  schedule,
  packageCount,
  onAttach,
}: {
  schedule: MatterFeeScheduleView | null
  /** Packages available to attach. Zero hides the action. */
  packageCount: number
  onAttach: () => void
}) {
  if (!schedule) {
    return (
      <Card>
        <CardHeader className="border-b [.border-b]:pb-4">
          <CardTitle className="text-sm">Fee schedule</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <EmptyState
            icon={CalendarClock}
            title="No fee schedule"
            description={
              packageCount > 0
                ? 'Split the agreed fee across milestones that bill as the matter progresses, instead of one charge up front.'
                : 'A schedule can only be set on a matter that carries no charges yet.'
            }
            action={
              packageCount > 0 ? (
                <Button variant="outline" size="sm" onClick={onAttach}>
                  <Plus className="size-4" aria-hidden />
                  Set fee schedule
                </Button>
              ) : undefined
            }
          />
        </CardContent>
      </Card>
    )
  }

  const scheduled = schedule.milestones
    .filter(milestone => milestone.state === 'scheduled')
    .reduce((sum, milestone) => sum + milestone.amountCents, 0)

  return (
    <Card>
      <CardHeader className="border-b [.border-b]:pb-4">
        <CardTitle className="text-sm">Fee schedule</CardTitle>
        <div className="col-start-2 row-span-2 row-start-1 flex flex-wrap items-center gap-2 self-start justify-self-end">
          <span className="text-xs text-muted-foreground">
            {schedule.packageName ?? 'Custom'}
            {schedule.state !== 'active' && ` · ${schedule.state}`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[480px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Milestone</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="pr-4">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedule.milestones.map(milestone => (
                <TableRow key={milestone.id}>
                  <TableCell className="max-w-52 pl-4 whitespace-normal">
                    <span className="font-medium">{milestone.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {milestone.releasedAt
                        ? `Released ${formatFirmDate(milestone.releasedAt)}`
                        : milestone.terms}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {billingMoney(milestone.amountCents)}
                  </TableCell>
                  <TableCell className="pr-4">
                    <Badge variant={STATE_VARIANTS[milestone.state]}>
                      {STATE_LABELS[milestone.state]}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="pl-4">
                  Agreed fee
                  {scheduled > 0 && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {billingMoney(scheduled)} not yet billed
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {billingMoney(schedule.agreedTotalCents)}
                </TableCell>
                <TableCell className="pr-4" />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
