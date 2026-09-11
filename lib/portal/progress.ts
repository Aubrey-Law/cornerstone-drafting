import { parsePracticeArea } from '@/lib/practiceArea'
import type { MatterDetailsRow } from '@/types/matter-details'

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
export function progressFromMatterDetails(details: MatterDetailsRow | null): PortalProgress {
  const practice = parsePracticeArea(details?.practice_area)
  const track: PortalTrack = practice === 'Probate' ? 'probate' : practice === 'EP' || practice === 'EP-LP' ? 'estate-planning' : 'other'
  const facts: Array<[string, string, boolean]> = track === 'probate' ? [
    ['appointment', 'Representative appointed', Boolean(details?.pb_pr_appointment_date)],
    ['inventory', 'Inventory filed', Boolean(details?.pb_inventory_filed_date)],
    ['distribution', 'Final distribution recorded', Boolean(details?.pb_final_distribution_date)],
    ['closed', 'Estate closed', details?.pb_estate_closed === true || Boolean(details?.pb_estate_closed_date)],
  ] : track === 'estate-planning' ? [
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
