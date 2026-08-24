import { legalPlanDisplayName } from '@/lib/billing/billingType'
import { formatCurrency } from '@/lib/format'
import { calendarDayDifference } from '@/lib/utils'
import type { LeadListRow } from '@/lib/leads/viewTypes'

/**
 * The three facts a lead card has room for, derived once so the board and the
 * table cannot drift apart.
 *
 * Each replaces something that was structurally empty. Measured over the 35
 * open leads when this was written: 1 had a fee quoted, so the card's value
 * slot was blank on 34 of them; 22 had no source; and every card that needed
 * attention said only "Needs attention", which was true of 16 and therefore
 * told the reader nothing about which one to open.
 */

/** Where this lead's money comes from — the quote if there is one, else the plan. */
export function leadValueLabel(lead: LeadListRow): string | null {
  const fee = formatCurrency(lead.engagement_fee_quoted)
  if (fee) return fee
  // Before the fee is quoted the carrier is what says what the work is worth,
  // and it is recorded far earlier: 13 of 35 leads carry one.
  return legalPlanDisplayName(lead.billing_type) ?? null
}

/**
 * How long this lead has been waiting, or when its meeting is.
 *
 * A booked call is not a wait — the same distinction the aging board draws in
 * `is_scheduled` (20261015000000) — so it is reported as an appointment rather
 * than as silence.
 */
export function leadWaitingLabel(lead: LeadListRow, now: number = Date.now()): string | null {
  const appointment = lead.next_appointment_at
  if (appointment) {
    const days = calendarDayDifference(appointment, now)
    if (days !== null && days >= 0) {
      return days === 0 ? 'Meeting today' : days === 1 ? 'Meeting tomorrow' : `Meeting in ${days} days`
    }
  }

  const touched = lead.last_activity_at ?? lead.updated_at ?? lead.created_at
  if (!touched) return 'No contact yet'
  const quiet = calendarDayDifference(now, touched)
  if (quiet === null) return null
  if (quiet <= 0) return 'Touched today'
  return quiet === 1 ? 'Quiet 1 day' : `Quiet ${quiet} days`
}

const STALE_DAYS = 7

/**
 * Why this lead needs attention, or null when it does not.
 *
 * Mirrors `needsAttention()` in LeadPipelineInsights, which returns only a
 * boolean — the cards showed that boolean as a chip reading "Needs attention",
 * which was on 16 of 35 leads and said nothing about which to open first.
 */
export function leadAttentionReason(lead: LeadListRow, now: number = Date.now()): string | null {
  if ((lead.lead_status ?? 'lead') !== 'lead') return null
  if (lead.lead_urgency === 'high') return 'High urgency'

  const touched = lead.last_activity_at ?? lead.updated_at ?? lead.created_at
  if (!touched) return 'Never contacted'
  const quiet = calendarDayDifference(now, touched)
  if (quiet === null || quiet <= STALE_DAYS) return null
  return `Quiet ${quiet} days`
}
