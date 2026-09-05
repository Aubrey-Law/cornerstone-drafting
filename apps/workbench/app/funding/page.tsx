import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LOGIN_PATH } from '@/lib/auth/gate'
import { formatMoney } from '@/lib/funding/format'
import { loadFundingRows } from '@/lib/funding/repository'
import { summariseMatters } from '@/lib/funding/rollup'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

export const metadata = { title: 'Funding · Aubrey Law Workbench' }

/**
 * The funding worklist, ordered by exposure.
 *
 * An unfunded trust is the largest malpractice exposure in this practice: the
 * documents are right, the client believes they are protected, and the assets
 * pass through probate anyway because nobody changed the title. This page
 * exists to answer one question — which client is most exposed right now — so
 * it leads with a dollar figure rather than a count of open items.
 */
export default async function FundingPage() {
  const user = await getSessionUser()
  if (!user) redirect(LOGIN_PATH)

  const matters = summariseMatters(await loadFundingRows(getAdminClient()))
  const totalUnfunded = matters.reduce((sum, m) => sum + m.summary.unfundedValue, 0)
  const outstanding = matters.filter((m) => !m.summary.isComplete)

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="mb-8 space-y-2">
        <Link href="/" className="text-xs text-muted-foreground underline underline-offset-4">
          Workbench
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Funding</h1>
        {matters.length === 0 ? null : (
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">{formatMoney(totalUnfunded)}</span> sits
            outside the plans on {outstanding.length}{' '}
            {outstanding.length === 1 ? 'matter' : 'matters'}.
          </p>
        )}
      </div>

      {matters.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hired matter has assets recorded at intake yet. Funding is tracked against the assets
          the client listed, so there is nothing to show until one does.
        </p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {matters.map((matter) => (
            <li key={matter.matterId}>
              <Link
                href={`/funding/${matter.matterId}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4 hover:bg-muted/50"
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
    </main>
  )
}
