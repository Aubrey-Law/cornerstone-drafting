import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Signature } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { loadCeremonyStatuses, type CeremonyStatus } from '@/lib/ceremony/repository'
import { executionKinds, loadExecutionMatters } from '@/lib/execution/repository'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { TONE_BADGE, type Tone } from '@/lib/ui/tone'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Execution' }

/**
 * Every hired matter with drafted documents, and what each needs to be signed
 * properly in Massachusetts. Ported from the workbench's `/execution`.
 */
const SIGNING_BADGE: Record<CeremonyStatus, { label: string; tone: Tone }> = {
  scheduled: { label: 'Scheduled', tone: 'info' },
  completed: { label: 'Signed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export default async function ExecutionPage() {
  await requireStaffPage()

  const client = reviewClient()
  const drafted = (await loadExecutionMatters(client)).filter(matter => matter.documentNames.length > 0)
  const statuses = await loadCeremonyStatuses(client, drafted.map(matter => matter.matterId))
  // Still to sign first, the same count the Matters dashboard's Close-out card shows.
  const matters = drafted
    .map(matter => ({
      ...matter,
      detected: executionKinds(matter),
      signing: statuses.get(matter.matterId) ?? null,
    }))
    .sort((a, b) => Number(a.signing === 'completed') - Number(b.signing === 'completed') || a.title.localeCompare(b.title))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Execution"
        description="What each document needs to be signed properly in Massachusetts, and the record of the signing."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/matters">
              <ArrowLeft className="size-4" aria-hidden />
              Matters
            </Link>
          </Button>
        }
      />

      <Card className="gap-0 py-0">
        {matters.length === 0 ? (
          <EmptyState
            icon={Signature}
            title="Nothing to sign yet"
            description="No hired matter has drafted documents yet."
          />
        ) : (
          <ul className="divide-y divide-border" data-testid="execution-worklist">
            {matters.map(matter => (
              <li key={matter.matterId}>
                <Link
                  href={`/admin/matters/${matter.matterId}?tab=documents&view=signing`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-accent"
                >
                  <span className="text-sm font-medium">{matter.title}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {matter.detected.kinds.length} document{matter.detected.kinds.length === 1 ? '' : 's'} recognised
                    {matter.detected.unmatched.length > 0 ? (
                      <Badge variant="outline" className={cn('text-micro', TONE_BADGE.warning)}>
                        {matter.detected.unmatched.length} to confirm
                      </Badge>
                    ) : null}
                    {matter.signing ? (
                      <Badge variant="outline" className={cn('text-micro', TONE_BADGE[SIGNING_BADGE[matter.signing].tone])}>
                        {SIGNING_BADGE[matter.signing].label}
                      </Badge>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
