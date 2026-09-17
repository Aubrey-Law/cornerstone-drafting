import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LOGIN_PATH } from '@/lib/auth/gate'
import { detectKinds } from '@/lib/execution/detect'
import { loadExecutionMatters } from '@/lib/execution/repository'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

export const metadata = { title: 'Execution · Aubrey Law Workbench' }

export default async function ExecutionPage() {
  const user = await getSessionUser()
  if (!user) redirect(LOGIN_PATH)

  const matters = (await loadExecutionMatters(getAdminClient()))
    .map((matter) => ({ ...matter, detected: detectKinds(matter.documentNames) }))
    .filter((matter) => matter.documentNames.length > 0)
    .sort((a, b) => a.title.localeCompare(b.title))

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-8 space-y-2">
        <Link href="/" className="text-xs text-muted-foreground underline underline-offset-4">
          Workbench
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Execution</h1>
        <p className="text-muted-foreground">
          What each document needs to be signed properly in Massachusetts, per matter.
        </p>
      </div>

      {matters.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hired matter has drafted documents yet.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {matters.map((matter) => (
            <li key={matter.matterId}>
              <Link
                href={`/execution/${matter.matterId}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4 hover:bg-accent"
              >
                <span className="font-medium">{matter.title}</span>
                <span className="text-sm text-muted-foreground">
                  {matter.detected.kinds.length} document
                  {matter.detected.kinds.length === 1 ? '' : 's'} recognised
                  {matter.detected.unmatched.length > 0
                    ? ` · ${matter.detected.unmatched.length} to confirm`
                    : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
