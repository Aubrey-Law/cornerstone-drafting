import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { loadCeremony } from '@/lib/ceremony/repository'
import { detectKinds } from '@/lib/execution/detect'
import { loadExecutionMatters } from '@/lib/execution/repository'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { CeremonyRecord } from './CeremonyRecord'
import { ExecutionChecklist } from './ExecutionChecklist'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Signing' }

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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Signing"
        title={matter.title}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/execution">
                <ArrowLeft className="size-4" aria-hidden />
                All signings
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/matters/${matterId}?tab=documents`}>Open matter</Link>
            </Button>
          </>
        }
      />

      <ExecutionChecklist detected={detected.kinds} unmatched={detected.unmatched} />
      <CeremonyRecord matterId={matterId} ceremony={ceremony} kinds={detected.kinds} />
    </div>
  )
}
