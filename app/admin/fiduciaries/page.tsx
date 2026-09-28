import type { Metadata } from 'next'
import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { loadFiduciaryOverview } from '@/lib/fiduciary/view'
import { requireStaffPage, reviewClient } from '@/lib/review/staff'
import { TONE_BADGE } from '@/lib/ui/tone'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Fiduciaries' }

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
    <div className="space-y-4">
      <PageHeader
        title="Fiduciaries"
        description={
          <>
            Who holds which office, across every document at once, for each hired matter.
            {matters.length > 0 ? ` ${withGaps} of ${matters.length} ${matters.length === 1 ? 'has' : 'have'} a gap.` : ''}
          </>
        }
      />

      <Card className="gap-0 py-0">
        {matters.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="No appointments yet"
            description="No hired matter has appointments recorded yet."
          />
        ) : (
          <ul className="divide-y divide-border" data-testid="fiduciary-overview">
            {matters.map(matter => (
              <li key={matter.matterId}>
                <Link
                  href={`/admin/matters/${matter.matterId}?tab=people`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-accent"
                >
                  <span className="text-sm font-medium">{matter.title}</span>
                  <Badge
                    variant="outline"
                    className={cn('text-micro', TONE_BADGE[matter.gaps > 0 ? 'warning' : 'neutral'])}
                  >
                    {matter.gaps === 0 ? 'No gaps' : `${matter.gaps} ${matter.gaps === 1 ? 'gap' : 'gaps'}`}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
