import Link from 'next/link'
import { loadFiduciaryOverview } from '@/lib/fiduciary/view'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'

export const dynamic = 'force-dynamic'

/**
 * Every hired matter with appointments recorded, gaps first. A gap is an
 * office with no successor, minor children with no guardian, or one person
 * named twice in a chain; each also opens a task on its matter. Ported from
 * the workbench's `/fiduciary`.
 */
export default async function FiduciariesPage() {
  await requireStaffPage()
  const matters = await loadFiduciaryOverview(reviewClient())
  const withGaps = matters.filter(matter => matter.gaps > 0).length

  return (
    <div className="space-y-4 px-6 py-5">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">Fiduciaries</h1>
        <p className="text-sm text-muted-foreground">
          Who holds which office, across every document at once, for each hired matter.
          {matters.length > 0 ? ` ${withGaps} of ${matters.length} ${matters.length === 1 ? 'has' : 'have'} a gap.` : ''}
        </p>
      </header>

      {matters.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hired matter has appointments recorded yet.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border" data-testid="fiduciary-overview">
          {matters.map(matter => (
            <li key={matter.matterId}>
              <Link
                href={`/admin/matters/${matter.matterId}?tab=people`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-2 py-3 hover:bg-accent"
              >
                <span className="font-medium">{matter.title}</span>
                <span className={matter.gaps > 0 ? 'text-sm text-warning' : 'text-sm text-muted-foreground'}>
                  {matter.gaps === 0 ? 'No gaps' : `${matter.gaps} ${matter.gaps === 1 ? 'gap' : 'gaps'}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
