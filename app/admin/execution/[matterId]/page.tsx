import Link from 'next/link'
import { notFound } from 'next/navigation'
import { loadCeremony } from '@/lib/ceremony/repository'
import { detectKinds } from '@/lib/execution/detect'
import { loadExecutionMatters } from '@/lib/execution/repository'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { CeremonyRecord } from './CeremonyRecord'
import { ExecutionChecklist } from './ExecutionChecklist'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One matter's signing: the checklist of what each drafted document needs,
 * and the record of the appointment itself. Ported from the workbench's
 * `/execution/[matterId]`.
 */
export default async function MatterExecutionPage({ params }: { params: Promise<{ matterId: string }> }) {
  await requireStaffPage()

  const { matterId } = await params
  if (!UUID.test(matterId)) notFound()

  const client = reviewClient()
  const [matter] = await loadExecutionMatters(client, { matterId })
  if (!matter) notFound()

  const detected = detectKinds(matter.documentNames)
  const ceremony = await loadCeremony(client, matterId)

  return (
    <div className="space-y-6 px-6 py-5">
      <header className="space-y-1">
        <Link href="/admin/execution" className="text-xs text-muted-foreground underline underline-offset-4">
          Execution
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">
          <Link href={`/admin/matters/${matterId}?tab=documents`} className="hover:underline">
            {matter.title}
          </Link>
        </h1>
      </header>

      <div className="space-y-12">
        <ExecutionChecklist detected={detected.kinds} unmatched={detected.unmatched} />
        <CeremonyRecord matterId={matterId} ceremony={ceremony} kinds={detected.kinds} />
      </div>
    </div>
  )
}
