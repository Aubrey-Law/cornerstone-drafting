import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { LOGIN_PATH } from '@/lib/auth/gate'
import { detectKinds } from '@/lib/execution/detect'
import { loadExecutionMatters } from '@/lib/execution/repository'
import { getAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/supabase/server'
import { ExecutionChecklist } from './ExecutionChecklist'

export const metadata = { title: 'Execution · Aubrey Law Workbench' }

export default async function MatterExecutionPage({
  params,
}: {
  params: Promise<{ matterId: string }>
}) {
  const user = await getSessionUser()
  if (!user) redirect(LOGIN_PATH)

  const { matterId } = await params
  const [matter] = await loadExecutionMatters(getAdminClient(), { matterId })
  if (!matter) notFound()

  const detected = detectKinds(matter.documentNames)

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-8 space-y-2">
        <Link href="/execution" className="text-xs text-muted-foreground underline underline-offset-4">
          Execution
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{matter.title}</h1>
      </div>

      <ExecutionChecklist detected={detected.kinds} unmatched={detected.unmatched} />
    </main>
  )
}
