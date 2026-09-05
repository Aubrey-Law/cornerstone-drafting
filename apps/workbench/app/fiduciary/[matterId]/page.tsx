import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { LOGIN_PATH } from '@/lib/auth/gate'
import { buildMatrix, matrixIssues, roleLabel, type MatrixIssue } from '@/lib/fiduciary/matrix'
import { loadFiduciaries } from '@/lib/fiduciary/repository'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'

export const metadata = { title: 'Fiduciaries · Aubrey Law Workbench' }

const SEVERITY_CLASS: Record<MatrixIssue['severity'], string> = {
  error: 'border-destructive/50 bg-destructive/10',
  gap: 'border-yellow-500/50 bg-yellow-500/10',
  note: 'border-border bg-muted',
}

const SEVERITY_LABEL: Record<MatrixIssue['severity'], string> = {
  error: 'Contradiction. ',
  gap: 'Gap. ',
  note: 'Worth knowing. ',
}

export default async function MatterFiduciaryPage({
  params,
}: {
  params: Promise<{ matterId: string }>
}) {
  const user = await getSessionUser()
  if (!user) redirect(LOGIN_PATH)

  const { matterId } = await params
  const [matter] = await loadFiduciaries(getAdminClient(), { matterId })
  if (!matter) notFound()

  const matrix = buildMatrix(matter.appointments)
  const issues = matrixIssues(matrix, { minorChildren: matter.minorChildren })

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-8 space-y-2">
        <Link href="/fiduciary" className="text-xs text-muted-foreground underline underline-offset-4">
          Fiduciaries
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{matter.title}</h1>
      </div>

      {issues.length > 0 ? (
        <ul className="mb-8 space-y-2" data-testid="issues">
          {issues.map((issue) => (
            <li key={issue.message} className={`rounded-md border p-3 text-sm ${SEVERITY_CLASS[issue.severity]}`}>
              <span className="font-medium">{SEVERITY_LABEL[issue.severity]}</span>
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      <section className="mb-10 space-y-3">
        <h2 className="text-sm font-semibold">Each office, in order of service</h2>
        {matrix.chains.length === 0 ? (
          <p className="text-sm text-muted-foreground">No appointments recorded.</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {matrix.chains.map((chain) => (
              <li key={`${chain.role}:${chain.forParty}`} className="py-3" data-testid={`chain-${chain.role}-${chain.forParty}`}>
                <p className="text-sm font-medium">
                  {roleLabel(chain.role)}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    for the {chain.forParty}
                  </span>
                </p>
                <ol className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                  {chain.people.map((person, index) => (
                    <li key={`${person.contactId}:${person.priority}:${index}`}>
                      {index + 1}. {person.name}
                      {person.isCoagent ? ' (co-agent)' : ''}
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Each person, and what they hold</h2>
        <ul className="divide-y divide-border border-y border-border">
          {matrix.people.map((person) => (
            <li key={person.contactId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
              <span className="text-sm font-medium">{person.name}</span>
              <span className="text-sm text-muted-foreground">
                {[...new Set(person.appointments.map((a) => roleLabel(a.role)))].join(', ')}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
