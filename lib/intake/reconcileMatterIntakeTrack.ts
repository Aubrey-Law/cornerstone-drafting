/**
 * Keep a matter's intake questionnaire aligned with its practice area.
 *
 * The practice area is the single switch for what a matter *is* — it already
 * moves the design sheet's plan track (`lib/designSheet/reconcilePlanTrack.ts`)
 * and the SLA checklist. The questionnaire is the third thing that has to
 * follow: `client_intake.intake_track` selects the Guided Interview step list
 * and decides which fields the attorney intake sheet shows, so a matter
 * reclassified as a College Preparation Plan kept asking estate questions —
 * assets, spouse, trust — and hid the student's own.
 *
 * A second switch on the matter was the wrong answer here: the plan track used
 * to be independently settable and the lesson (see PlanTrackNotice) was that a
 * matter-level decision split across two controls just leaves them
 * contradicting each other. One switch, three followers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { isCollegePrepPracticeArea } from '@/lib/practiceArea'
import { getIntakeTrack, type IntakeTrack } from '@/lib/intakeTrack'

/** The questionnaire a matter's practice area calls for. */
export function intakeTrackForPracticeArea(practiceArea: unknown): IntakeTrack {
  return isCollegePrepPracticeArea(practiceArea) ? 'college_prep' : 'estate'
}

/**
 * Move a matter's intake onto its practice area's questionnaire.
 *
 * Best-effort by design, like the design-sheet reconcile: a practice area
 * change must not fail because the intake could not be updated.
 *
 * Unlike the client-facing switch (`/api/admin/intake/track`), this does not
 * refuse a submitted intake. That guard protects a client from having their
 * answers re-validated against questions they were never asked; here the
 * attorney has deliberately reclassified an engagement they own, and every
 * matter's intake is submitted by the time it becomes a matter — refusing
 * would mean the questionnaire could never follow the reclassification at all.
 * No answers are discarded either way: the estate columns and
 * `college_prep_details` coexist on the row, so switching back restores the
 * original view.
 *
 * Returns true when a write happened.
 */
export async function reconcileMatterIntakeTrack(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  matterId: string,
  practiceArea: unknown,
): Promise<boolean> {
  try {
    const track = intakeTrackForPracticeArea(practiceArea)

    const { data: matter } = await admin
      .from('matters')
      .select('client_intake_id')
      .eq('id', matterId)
      .maybeSingle()

    const intakeId = (matter as { client_intake_id?: string | null } | null)?.client_intake_id
    if (!intakeId) return false

    const { data: intake } = await admin
      .from('client_intake')
      .select('id, intake_track')
      .eq('id', intakeId)
      .maybeSingle()

    if (!intake) return false
    if (getIntakeTrack(intake as Record<string, unknown>) === track) return false

    const { error } = await admin
      .from('client_intake')
      .update({ intake_track: track, updated_at: new Date().toISOString() })
      .eq('id', intakeId)

    if (error) {
      console.warn('[intake-track] matter intake reconcile failed', matterId, error.message)
      return false
    }
    return true
  } catch (error) {
    console.warn('[intake-track] matter intake reconcile threw', matterId, error)
    return false
  }
}
