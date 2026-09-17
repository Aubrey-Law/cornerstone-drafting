'use client'

import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { getDesignPlanTrack } from '@/lib/collegePrepDesign'
import { practiceAreaLabel } from '@/lib/practiceArea'
import { SectionBlock } from './shared'

interface PlanTrackNoticeProps {
  matterId: string
  practiceArea: string | null
}

/**
 * Says which plan this sheet drafts, and sends the attorney to the one place
 * that changes it.
 *
 * The track used to be switchable from inside the sheet, which put a
 * matter-level decision in a place nobody looked for it and left the practice
 * area saying something different. The practice area is the switch now
 * (`lib/designSheet/reconcilePlanTrack.ts` moves the sheet to follow it), so
 * this is a read-only pointer rather than a second control.
 */
export function PlanTrackNotice({ matterId, practiceArea }: PlanTrackNoticeProps) {
  const label = practiceAreaLabel(practiceArea)

  return (
    <SectionBlock
      title="Plan track"
      subtitle="Set by the matter's practice area — it decides the sections, the documents, and the drafting checks."
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted p-3">
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {practiceArea === 'CP'
              ? 'Power of attorney, health care proxy, HIPAA, living will, and the FERPA release.'
              : 'Trust, will, powers of attorney, health care, and transfers.'}
          </p>
        </div>
        <Link
          href={`/admin/matters/${matterId}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-[var(--gi-teal)]"
        >
          Change on the matter
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
    </SectionBlock>
  )
}

/**
 * Whether the sheet's marker disagrees with the practice area. Reconciliation
 * normally makes this impossible; it is worth showing rather than hiding,
 * because a sheet drafting the wrong plan is the failure this whole join exists
 * to prevent.
 */
export function planTrackMismatch(
  sheet: Parameters<typeof getDesignPlanTrack>[0],
  practiceArea: string | null,
): boolean {
  const expected = practiceArea === 'CP' ? 'college_prep' : 'estate'
  return getDesignPlanTrack(sheet) !== expected
}
