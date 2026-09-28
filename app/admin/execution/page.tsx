import type { Metadata } from 'next'
import Link from 'next/link'
import { Signature } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { detectKinds } from '@/lib/execution/detect'
import { loadExecutionMatters } from '@/lib/execution/repository'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { TONE_BADGE } from '@/lib/ui/tone'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Execution' }

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
    <div className="space-y-4">
      <PageHeader
        title="Execution"
        description="What each document needs to be signed properly in Massachusetts, and the record of the signing."
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
