import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
import { resolveDraftingDate } from '@/lib/matter/draftingDates'
import type { PipelineMatter } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'

export type MilestonePointState = 'done' | 'next' | 'later'

export interface MilestonePoint {
  label: string
  /** YYYY-MM-DD: when it happened, or when it is planned. */
  date: string | null
  state: MilestonePointState
  /** The date is planned (or derived from target signing), not recorded. */
  planned: boolean
}

/**
 * The five points of an engagement the Overview milestones card plots. A point
 * is done only when its fact is recorded — stage alone never ticks one, so a
 * matter moved past intake without a submitted intake still shows it open.
 * Nothing here is stored; it is read from `matter_details` and the pipeline row.
 */
export function matterMilestoneTrack(
  matter: PipelineMatter,
  details: MatterDetailsRow | null,
  today = firmTodayKey(),
): MilestonePoint[] {
  const design = firmDateKey(details?.design_meeting_date)
  const draftsDue = resolveDraftingDate(details, 'drafts_due').value
  const points: { label: string; actual: string | null; planned?: string | null; done?: boolean }[] = [
    {
      label: 'Engaged',
      actual: firmDateKey(details?.engagement_signed_at ?? details?.hired_date),
      done: Boolean(details?.engagement_signed),
    },
    { label: 'Intake in', actual: firmDateKey(details?.intake_completed_at ?? matter.intake_submitted_at) },
    { label: 'Design meeting', actual: design && design <= today ? design : null, planned: design },
    { label: 'Drafts to client', actual: firmDateKey(details?.draft_sent_date ?? matter.drafts_sent_at), planned: firmDateKey(draftsDue) },
    {
      label: 'Signing',
      actual: firmDateKey(details?.signing_date ?? matter.signing_date ?? matter.documents_executed_at),
      planned: firmDateKey(details?.scheduled_signing_date),
    },
  ]
  // The next point is the first open one after the furthest recorded one; an
  // earlier gap (say, an intake never submitted) stays hollow rather than
  // pulling "next" backwards.
  const lastDone = points.map(point => Boolean(point.done || point.actual)).lastIndexOf(true)
  const nextIndex = points.findIndex((point, index) => index > lastDone && !(point.done || point.actual))
  return points.map((point, index) => {
    const done = Boolean(point.done || point.actual)
    return {
      label: point.label,
      date: point.actual ?? point.planned ?? null,
      state: done ? 'done' : index === nextIndex ? 'next' : 'later',
      planned: !point.actual && Boolean(point.planned),
    }
  })
}

/** Share of the connector to fill: up to the last done point. */
export function milestoneTrackProgress(points: MilestonePoint[]): number {
  const lastDone = points.map(point => point.state).lastIndexOf('done')
  if (lastDone <= 0 || points.length < 2) return 0
  return lastDone / (points.length - 1)
}
