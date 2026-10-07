import { parsePracticeArea } from '@/lib/practiceArea'
import type { MatterDetailsRow } from '@/types/matter-details'
import { firmTodayKey } from '@/lib/firmDate'
import { readProbateStage } from '@/lib/probateStages/model'

export type PortalTrack = 'estate-planning' | 'probate' | 'other'
export type PortalMilestone = { key: string; label: string; state: 'completed' | 'current' | 'pending' }
export type PortalProgress = { heading: string; milestones: readonly PortalMilestone[]; nextAction: string | null }
export type PortalProgressInput = PortalProgress & { track: PortalTrack }

export function portalProgress(input: Omit<PortalProgressInput, 'heading'>): PortalProgress {
  return {
    heading: input.track === 'probate' ? 'Your probate matter' : input.track === 'estate-planning' ? 'Your estate plan' : 'Your matter',
    milestones: input.milestones,
    nextAction: input.nextAction,
  }
}

/** Only recorded facts complete milestones. Later facts never fill earlier gaps. */
export function progressFromMatterDetails(details: MatterDetailsRow | null, today: string = firmTodayKey()): PortalProgress {
  const practice = parsePracticeArea(details?.practice_area)
  const track: PortalTrack = practice === 'Probate' ? 'probate' : practice === 'EP' || practice === 'EP-LP' ? 'estate-planning' : 'other'
  // Probate milestones are the probate stages the firm sees, each complete
  // only when its own date is on the record (lib/probateStages/model.ts).
  const facts: Array<[string, string, boolean]> = track === 'probate' ? readProbateStage(details, today).steps
    .filter(step => step.key !== 'probate_opening')
    .map((step): [string, string, boolean] => [step.key.replace(/^probate_/, ''), step.clientLabel, step.reachedOn !== null])
  : track === 'estate-planning' ? [
    ['intake', 'Intake received', Boolean(details?.intake_completed_at || details?.intake_date)],
    ['drafts', 'Drafts sent', Boolean(details?.draft_sent_date)],
    ['review', 'Drafts approved', Boolean(details?.drafts_approved_date)],
    ['signing', 'Documents signed', Boolean(details?.execution_date || details?.signing_date)],
  ] : []
  return portalProgress({
    track,
    milestones: facts.map(([key, label, completed]) => ({ key, label, state: completed ? 'completed' : 'pending' })),
    nextAction: 'Check Messages for requests and updates from the firm. Contact us if you have questions about your next step.',
  })
}
