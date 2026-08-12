import 'server-only'
import { firmDateKey } from '@/lib/firmDate'
import { applySlaAnchor } from '@/lib/slaTasks/generate'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { findMatterIdByLeadId } from './link'

type AdminClient = ReturnType<typeof getAdminClient>

export interface DiscoveryAnchorInput {
  leadId: string | null
  matterId: string | null
  startIso: string
  /**
   * A first booking is write-once; a reschedule overwrites.
   *
   * Write-once is what keeps an online booking from clobbering a date an
   * attorney corrected by hand. A reschedule is the calendar's actual truth and
   * has to win outright: `stage_entered_at` is pinned to this column, so a
   * stale date would report an SLA breach for a call that has not happened yet.
   */
  overwrite: boolean
}

/**
 * Record a booked discovery call as the matter's `discovery_call_at`.
 *
 * The discovery call is the pre-engagement clock's first anchor: four v3 tasks
 * carry `relative_to = 'discovery_call'` and are generated undated, so until
 * this column exists the lead's plan is blank at the point it becomes
 * actionable — the same hole `recordPmpsAnchor` fills for the planning session.
 *
 * Both writers route through here so the online path and the key-dates panel
 * cannot drift: 20260910000000_lead_discovery_stage.sql moves the lead's stage
 * off this column from a BEFORE trigger, so whoever writes it gets the stage
 * move for free — but only the writers that actually write it.
 *
 * The matter is resolved from the lead when there is no hired one, because a
 * discovery call happens before anyone is hired, which is exactly when the
 * hired-only `findMatterIdByEmail` finds nothing.
 */
export async function recordDiscoveryAnchor(
  admin: AdminClient,
  input: DiscoveryAnchorInput,
): Promise<void> {
  // Guards the write, not the anchor: a timestamp that cannot be reduced to a
  // firm-timezone day has no business being stamped in the first place.
  if (!firmDateKey(input.startIso)) return

  const matterId =
    input.matterId ?? (input.leadId ? await findMatterIdByLeadId(admin, input.leadId) : null)
  if (!matterId) return

  const query = admin
    .from('matters')
    .update({ discovery_call_at: new Date(input.startIso).toISOString() })
    .eq('id', matterId)
  const { error } = input.overwrite ? await query : await query.is('discovery_call_at', null)
  if (error) throw error

  // Date the tasks from the value that actually landed, not from the value we
  // offered. Under write-once those differ precisely when an attorney already
  // recorded a date: stamping the plan with the booking day would leave the
  // tasks describing a call the column says happens on some other day.
  const { data, error: readError } = await admin
    .from('matters')
    .select('discovery_call_at')
    .eq('id', matterId)
    .maybeSingle()
  if (readError) throw readError

  const stored = (data as { discovery_call_at: string | null } | null)?.discovery_call_at ?? null
  const anchorDay = stored ? firmDateKey(stored) : null
  if (!anchorDay) return

  // Recomputed from each task's stored offsets, so re-running after the date
  // moves again is idempotent rather than cumulative.
  const result = await applySlaAnchor(admin, matterId, 'discovery_call', anchorDay)
  if (!result.ok) {
    console.warn('[bookings] discovery task reschedule skipped for matter', matterId, result.error)
  }
}
