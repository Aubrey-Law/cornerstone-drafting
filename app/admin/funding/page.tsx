import type { Metadata } from 'next'
import Link from 'next/link'
import { Landmark } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { formatMoney } from '@/lib/funding/format'
import { loadFundingRows } from '@/lib/funding/repository'
import { summariseMatters } from '@/lib/funding/rollup'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { TONE_BADGE } from '@/lib/ui/tone'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Funding' }

/**
 * The trust-funding worklist, ordered by exposure. An unfunded trust is the
 * largest malpractice exposure in this practice: the documents are right, the
 * client believes they are protected, and the assets pass through probate
 * anyway because nobody changed the title. So this leads with a dollar figure
 * rather than a count of open items. Ported from the workbench's `/funding`.
 */
export default async function FundingPage() {
  await requireStaffPage()

  const matters = summariseMatters(await loadFundingRows(reviewClient()))
  const totalUnfunded = matters.reduce((sum, m) => sum + m.summary.unfundedValue, 0)
  const outstanding = matters.filter(m => !m.summary.isComplete)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Funding"
        description={
          matters.length === 0 ? undefined : (
            <>
              <span className="font-medium text-foreground">{formatMoney(totalUnfunded)}</span> sits
              outside the plans on {outstanding.length} {outstanding.length === 1 ? 'matter' : 'matters'}.
            </>
          )
        }
      />

      <Card className="gap-0 py-0">
        {matters.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="Nothing to fund yet"
            description="No hired matter has assets recorded at intake yet. Funding is tracked against the assets the client listed, so there is nothing to show until one does."
          />
        ) : (
          <ul className="divide-y divide-border" data-testid="funding-worklist">
            {matters.map(matter => (
              <li key={matter.matterId}>
                <Link
                  href={`/admin/matters/${matter.matterId}?tab=assets&view=funding`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-accent"
                >
                  <span className="text-sm font-medium">{matter.title}</span>
                  <span className="flex items-center gap-3 text-sm">
                    {matter.summary.isComplete ? (
                      <Badge variant="outline" className={cn('text-micro', TONE_BADGE.success)}>
                        Fully funded
                      </Badge>
                    ) : (
                      <>
                        <span className="font-medium tabular-nums">{formatMoney(matter.summary.unfundedValue)}</span>
                        <span className="text-xs text-muted-foreground">
                          {matter.summary.unfundedCount} of {matter.summary.total} outstanding
                        </span>
                      </>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
