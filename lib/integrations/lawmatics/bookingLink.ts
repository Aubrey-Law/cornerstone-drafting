import 'server-only'

import { getAdminClient } from '@/lib/supabaseAdmin'
import { IntegrationError } from '@/lib/integrations/errors'
import { pushLeadToLawmatics } from './push'

/**
 * Lawmatics events carry no metadata, so a booking made from a Cornerstone
 * link can only be tied back to its lead through the Lawmatics prospect it
 * lands on. Before a Lawmatics booking link is sent (or opened for staff to
 * book), the lead is pushed to Lawmatics: that creates or updates its
 * prospect and records the prospect ↔ lead link that the calendar import
 * (lib/integrations/lawmatics/inbound.ts) resolves the booking through.
 *
 * Never throws: a failed push still lets the link go out, and the import
 * falls back to matching the booking by email. The caller shows `warning`.
 */
export interface LawmaticsBookingPrep {
  intakeId: string | null
  prospectId: string | null
  operation: 'created' | 'updated' | null
  warning: string | null
}

async function intakeIdFor(target: { leadId: string | null; matterId: string | null }): Promise<string | null> {
  if (target.leadId) return target.leadId
  if (!target.matterId) return null
  const { data, error } = await getAdminClient()
    .from('matters').select('client_intake_id').eq('id', target.matterId).maybeSingle()
  if (error) throw error
  return (data as { client_intake_id: string | null } | null)?.client_intake_id ?? null
}

export async function prepareLawmaticsBooking(
  target: { leadId: string | null; matterId: string | null },
  actorId: string | null,
): Promise<LawmaticsBookingPrep> {
  let intakeId: string | null = null
  try {
    intakeId = await intakeIdFor(target)
    if (!intakeId) {
      return { intakeId: null, prospectId: null, operation: null,
        warning: 'This matter has no client record to link in Lawmatics; the booking will be matched by email.' }
    }
    const result = await pushLeadToLawmatics(intakeId)
    const { error: activityError } = await getAdminClient().from('lead_activity').insert({
      lead_id: intakeId,
      event_type: 'lawmatics_pushed',
      title: result.operation === 'created' ? 'Created in Lawmatics' : 'Updated in Lawmatics',
      detail: 'Linked before sending a Lawmatics booking link',
      actor_id: actorId,
    })
    if (activityError) console.error('[lawmatics/booking-link] activity log failed', activityError.message)
    return { intakeId, prospectId: result.prospectId, operation: result.operation, warning: null }
  } catch (error) {
    const reason = error instanceof IntegrationError ? error.safeMessage : 'The Lawmatics push failed.'
    if (!(error instanceof IntegrationError)) {
      console.error('[lawmatics/booking-link] push failed', error instanceof Error ? error.name : 'unknown')
    }
    return { intakeId, prospectId: null, operation: null,
      warning: `${reason} The booking will be matched to this client by email instead.` }
  }
}
