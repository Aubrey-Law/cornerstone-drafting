import Link from 'next/link'
import { detectKinds } from '@/lib/execution/detect'
import { loadExecutionMatters } from '@/lib/execution/repository'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'

export const dynamic = 'force-dynamic'

/**
 * Every hired matter with drafted documents, and what each needs to be signed
 * properly in Massachusetts. Ported from the workbench's `/execution`.
 */
export default async function ExecutionPage() {
  await requireStaffPage()

  const matters = (await loadExecutionMatters(reviewClient()))
    .map(matter => ({ ...matter, detected: detectKinds(matter.documentNames) }))
    .filter(matter => matter.documentNames.length > 0)
    .sort((a, b) => a.title.localeCompare(b.title))

  return (
    <div className="space-y-4 px-6 py-5">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">Execution</h1>
        <p className="text-sm text-muted-foreground">
          What each document needs to be signed properly in Massachusetts, and the record of the signing.
        </p>
      </header>

      {matters.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hired matter has drafted documents yet.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border" data-testid="execution-worklist">
          {matters.map(matter => (
            <li key={matter.matterId}>
              <Link
                href={`/admin/execution/${matter.matterId}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-2 py-3 hover:bg-accent"
              >
                <span className="font-medium">{matter.title}</span>
                <span className="text-sm text-muted-foreground">
                  {matter.detected.kinds.length} document{matter.detected.kinds.length === 1 ? '' : 's'} recognised
                  {matter.detected.unmatched.length > 0 ? ` · ${matter.detected.unmatched.length} to confirm` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
