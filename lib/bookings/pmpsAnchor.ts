import 'server-only'
import { firmDateKey } from '@/lib/firmDate'
import { applySlaAnchor } from '@/lib/slaTasks/generate'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { findMatterIdByLeadId } from './link'

type AdminClient = ReturnType<typeof getAdminClient>

/**
 * Record a booked Peace of Mind Planning Session as the matter's `pmps_at`.
 *
 * Under the v3 SLA the PMPS is the pivot of the whole pre-engagement stretch:
 * the organizer is due the day before it, prep the day before that,
 * recommendations the day after, and the engagement signature four days later.
 * Every one of those tasks is generated undated and stays that way until this
 * column exists, so booking the session without stamping it leaves the lead's
 * plan blank at exactly the point it becomes actionable.
 *
 * The matter is resolved from the lead when there is no hired one, because the
 * session happens *before* anyone is hired — which is why the hired-only
 * `findMatterIdByEmail` used everywhere else finds nothing here.
 *
 * Setting the column also moves a lead to Planning Session; that belongs to the
 * `stamp_lead_pmps_stage` trigger, so an attorney typing the date into the
 * key-dates panel gets the same result as a client booking online.
 */
export async function recordPmpsAnchor(
  admin: AdminClient,
  input: { leadId: string | null; matterId: string | null; startIso: string },
): Promise<void> {
  const anchorDay = firmDateKey(input.startIso)
  if (!anchorDay) return

  const matterId =
    input.matterId ?? (input.leadId ? await findMatterIdByLeadId(admin, input.leadId) : null)
  if (!matterId) return

  const { error } = await admin
    .from('matters')
    .update({ pmps_at: new Date(input.startIso).toISOString() })
    .eq('id', matterId)
  if (error) throw error

  // Recomputed from each task's stored offsets, so a reschedule re-dates the
  // plan to the new day rather than shifting it twice.
  const result = await applySlaAnchor(admin, matterId, 'pmps', anchorDay)
  if (!result.ok) {
    console.warn('[bookings] pmps task reschedule skipped for matter', matterId, result.error)
  }
}
