import { firmDateKey, firmTodayKey } from '@/lib/firmDate'
import { resolveDraftingDate } from '@/lib/matter/draftingDates'
import { STAGES, type PipelineMatter } from '@/types/database'
import type { MatterDetailsRow } from '@/types/matter-details'

export interface MatterMilestone { label: string; date: string; daysAway: number; derived: boolean }

/** Stage progression retires earlier milestones; signing and engagement facts are history. */
export function nextMatterMilestone(matter: PipelineMatter, details: MatterDetailsRow | null, today = firmTodayKey()): MatterMilestone | null {
  if (matter.stage === 'closed' || ['closed', 'archived'].includes(matter.status)) return null
  const stage = STAGES.findIndex(item => item.key === matter.stage)
  const through = (last: string) => stage <= STAGES.findIndex(item => item.key === last)
  const signed = Boolean(details?.signing_date || matter.signing_date || matter.documents_executed_at)
  const candidates: { label: string; value: string | null | undefined; applies: boolean; derived?: boolean }[] = [
    { label: 'Design meeting', value: details?.design_meeting_date, applies: !signed && through('design') },
    ...(['drafts_due', 'drafts_review', 'revisions'] as const).map((key, index) => {
      const resolved = resolveDraftingDate(details, key)
      return { label: ['Drafts due', 'Drafts review', 'Revisions'][index], value: resolved.value,
        applies: !signed && through(['drafting', 'client_review', 'revision'][index]), derived: resolved.derived }
    }),
    { label: 'Target signing', value: details?.scheduled_signing_date, applies: !signed && through('signing_scheduled') },
    { label: 'Next action', value: details?.next_action_date, applies: true },
    { label: matter.next_appointment_type || 'Appointment', value: matter.next_appointment,
      applies: Boolean(matter.next_appointment && (firmDateKey(matter.next_appointment) ?? '') >= today) },
  ]
  return candidates.flatMap(item => {
    const date = firmDateKey(item.value)
    if (!item.applies || !date) return []
    const daysAway = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000)
    return [{ label: item.label, date, daysAway, derived: item.derived ?? false }]
  }).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
}
