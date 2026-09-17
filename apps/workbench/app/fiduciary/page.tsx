import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LOGIN_PATH } from '@/lib/auth/gate'
import { buildMatrix, matrixIssues } from '@/lib/fiduciary/matrix'
import { loadFiduciaries } from '@/lib/fiduciary/repository'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

export const metadata = { title: 'Fiduciaries · Aubrey Law Workbench' }

export default async function FiduciaryPage() {
  const user = await getSessionUser()
  if (!user) redirect(LOGIN_PATH)

  const matters = (await loadFiduciaries(getAdminClient()))
    .filter((matter) => matter.appointments.length > 0)
    .map((matter) => ({
      ...matter,
      issues: matrixIssues(buildMatrix(matter.appointments), { minorChildren: matter.minorChildren }),
    }))
    // Gaps first: the list exists to be worked down, not browsed.
    .sort((a, b) => {
      const gaps = (m: typeof a) => m.issues.filter((i) => i.severity !== 'note').length
      return gaps(b) - gaps(a) || a.title.localeCompare(b.title)
    })

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-8 space-y-2">
        <Link href="/" className="text-xs text-muted-foreground underline underline-offset-4">
          Workbench
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Fiduciaries</h1>
        <p className="text-muted-foreground">
          Who holds which office, across every document at once.
        </p>
      </div>

      {matters.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hired matter has appointments recorded yet.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {matters.map((matter) => {
            const gaps = matter.issues.filter((i) => i.severity !== 'note').length
            return (
              <li key={matter.matterId}>
                <Link
                  href={`/fiduciary/${matter.matterId}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4 hover:bg-accent"
                >
                  <span className="font-medium">{matter.title}</span>
                  <span className="text-sm text-muted-foreground">
                    {gaps === 0
                      ? 'No gaps'
                      : `${gaps} ${gaps === 1 ? 'gap' : 'gaps'}`}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
