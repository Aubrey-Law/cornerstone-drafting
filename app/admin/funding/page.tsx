import Link from 'next/link'
import { formatMoney } from '@/lib/funding/format'
import { loadFundingRows } from '@/lib/funding/repository'
import { summariseMatters } from '@/lib/funding/rollup'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'

export const dynamic = 'force-dynamic'

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
    <div className="space-y-4 px-6 py-5">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">Funding</h1>
        {matters.length === 0 ? null : (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{formatMoney(totalUnfunded)}</span> sits
            outside the plans on {outstanding.length} {outstanding.length === 1 ? 'matter' : 'matters'}.
          </p>
        )}
      </header>

      {matters.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hired matter has assets recorded at intake yet. Funding is tracked against the assets
          the client listed, so there is nothing to show until one does.
        </p>
      ) : (
        <ul className="divide-y divide-border border-y border-border" data-testid="funding-worklist">
          {matters.map(matter => (
            <li key={matter.matterId}>
              <Link
                href={`/admin/funding/${matter.matterId}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-2 py-3 hover:bg-accent"
              >
                <span className="font-medium">{matter.title}</span>
                <span className="flex items-baseline gap-3 text-sm">
                  {matter.summary.isComplete ? (
                    <span className="text-muted-foreground">Fully funded</span>
                  ) : (
                    <>
                      <span className="font-medium">{formatMoney(matter.summary.unfundedValue)}</span>
                      <span className="text-muted-foreground">
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
    </div>
  )
}
