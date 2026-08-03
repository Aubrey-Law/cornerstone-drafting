import type { LeadListRow } from '@/lib/leads/viewTypes'

/**
 * Board columns are derived from the lead record — there is no stored column.
 * Dropping a card therefore runs the action that moves the record, and the
 * card lands in the target column only once that action lands.
 */
export type LeadBoardColumnKey =
  | 'new'
  | 'intake_sent'
  | 'intake_complete'
  | 'engagement'
  | 'hired'
  | 'lost'
  | 'declined'

export type LeadBoardColumn = {
  key: LeadBoardColumnKey
  label: string
  /** Shown inside the column while it is empty. */
  hint: string
}

export const LEAD_BOARD_COLUMNS: LeadBoardColumn[] = [
  { key: 'new', label: 'New', hint: 'Leads with no intake sent yet' },
  { key: 'intake_sent', label: 'Intake sent', hint: 'Drop to send or resend the intake' },
  { key: 'intake_complete', label: 'Intake complete', hint: 'Lands here when the client submits' },
  { key: 'engagement', label: 'Engagement', hint: 'Drop to send the engagement agreement' },
  { key: 'hired', label: 'Hired', hint: 'Drop to create the matter' },
  { key: 'lost', label: 'Lost', hint: 'Drop to mark a lead lost' },
  { key: 'declined', label: 'Declined', hint: 'Leads turned away at discovery' },
]

/** What a drop resolves to; `none` carries the reason to show the user. */
export type LeadBoardDrop =
  | { kind: 'send_intake' }
  | { kind: 'send_engagement' }
  | { kind: 'hire' }
  | { kind: 'mark_lost' }
  | { kind: 'reopen' }
  | { kind: 'none'; reason: string | null }

function intakeComplete(lead: LeadListRow): boolean {
  return Boolean(lead.intake_completed_at) || lead.status === 'completed'
}

function engagementStarted(lead: LeadListRow): boolean {
  return Boolean(lead.engagement_sent_at)
    || lead.engagement_status === 'signed'
    || lead.engagement_status === 'declined'
}

export function leadBoardColumn(lead: LeadListRow): LeadBoardColumnKey {
  if (lead.lead_status === 'lost') return 'lost'
  // Without this a declined lead is placed by its timestamps, so one turned
  // away before any intake went out would sit in New looking brand new.
  if (lead.lead_status === 'declined') return 'declined'
  if (lead.lead_status === 'hired') return 'hired'
  // An engagement can go out before the intake is finished, so it wins.
  if (engagementStarted(lead)) return 'engagement'
  if (intakeComplete(lead)) return 'intake_complete'
  if (lead.intake_sent_at) return 'intake_sent'
  return 'new'
}

export function groupLeadsByBoardColumn<T extends LeadListRow>(
  leads: T[],
): Map<LeadBoardColumnKey, T[]> {
  const grouped = new Map<LeadBoardColumnKey, T[]>()
  for (const column of LEAD_BOARD_COLUMNS) grouped.set(column.key, [])
  for (const lead of leads) {
    const bucket = grouped.get(leadBoardColumn(lead))
    if (bucket) bucket.push(lead)
  }
  return grouped
}

export function resolveBoardDrop(lead: LeadListRow, target: LeadBoardColumnKey): LeadBoardDrop {
  const from = leadBoardColumn(lead)
  if (from === target) return { kind: 'none', reason: null }
  if (from === 'hired') {
    return { kind: 'none', reason: 'A hired lead is managed on its matter.' }
  }
  if (from === 'lost') {
    return target === 'new'
      ? { kind: 'reopen' }
      : { kind: 'none', reason: 'Drop a lost lead on New to reopen it first.' }
  }
  if (from === 'declined') {
    return target === 'new'
      ? { kind: 'reopen' }
      : { kind: 'none', reason: 'Drop a declined lead on New to reopen it first.' }
  }
  if (target === 'declined') {
    // Nothing in the app sets `declined` yet; the column exists so a lead
    // declined elsewhere is visible rather than mis-filed as active.
    return { kind: 'none', reason: 'Declining a lead is not available here yet.' }
  }
  if (target === 'lost') return { kind: 'mark_lost' }
  if (target === 'new') {
    return { kind: 'none', reason: 'Leads only return to New when a lost lead is reopened.' }
  }
  if (target === 'intake_sent') return { kind: 'send_intake' }
  if (target === 'intake_complete') {
    return { kind: 'none', reason: 'Intake completes when the client submits it.' }
  }
  if (target === 'engagement') return { kind: 'send_engagement' }
  // Hiring is named explicitly rather than left as the fallback: as a catch-all
  // it meant any column added later silently hired the lead on drop.
  if (target === 'hired') return { kind: 'hire' }
  return { kind: 'none', reason: null }
}
