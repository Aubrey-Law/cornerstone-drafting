/**
 * Keep a design sheet's plan track aligned with its matter's practice area.
 *
 * The practice area is the source of truth: it is a first-class matter field
 * with one obvious place to change it, it shows on the matter list and in
 * filters, and it drives the matter number. `decisions.plan_track` stays as the
 * sheet-level marker because every pure sheet reader — document inclusions,
 * readiness, section lists, the FERPA payload — takes a sheet and has no matter
 * in hand. This module is the join between the two.
 *
 * Reconciliation runs where the practice area is written (so drafting is
 * correct for the next reader, whether or not anyone opens the workspace) and
 * again when the drafting workspace loads (so rows changed by a backfill,
 * an import, or SQL still land on the right track).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import {
  getDesignPlanTrack,
  switchDesignPlanTrack,
  type DesignPlanTrack,
} from '@/lib/collegePrepDesign'
import { collegePrepDesignFromIntake } from '@/lib/designSheet/seedCollegePrep'
import { isCollegePrepPracticeArea } from '@/lib/practiceArea'
import type { IntakeSnapshot } from '@/lib/queries'
import type { DesignSheet } from '@/types/database'

/** The track a matter's practice area calls for. */
export function planTrackForPracticeArea(practiceArea: unknown): DesignPlanTrack {
  return isCollegePrepPracticeArea(practiceArea) ? 'college_prep' : 'estate'
}

export interface PlanTrackReconciliation {
  /** The track the sheet should be on. */
  track: DesignPlanTrack
  /** Null when the sheet already agrees — callers skip the write. */
  decisions: Record<string, unknown> | null
}

/**
 * Work out the decisions patch that moves a sheet onto its matter's track.
 *
 * Pure, so the drafting workspace and the API route share one definition of
 * what a track change does to the document set.
 */
export function reconcilePlanTrackDecisions(args: {
  sheet: Pick<DesignSheet, 'decisions'> | null | undefined
  practiceArea: unknown
  intake?: IntakeSnapshot | null
}): PlanTrackReconciliation {
  const track = planTrackForPracticeArea(args.practiceArea)
  if (!args.sheet) return { track, decisions: null }
  if (getDesignPlanTrack(args.sheet) === track) return { track, decisions: null }

  // Moving onto the college track adopts the student's questionnaire answers
  // when the matter collected them; the estate direction never needs them.
  const answers = track === 'college_prep' && args.intake?.intake_track === 'college_prep'
    ? collegePrepDesignFromIntake(args.intake)
    : null

  return { track, decisions: switchDesignPlanTrack(args.sheet, { track, answers }) }
}

/**
 * Persist the reconciliation for a matter. Best-effort by design: a practice
 * area change must not fail because the design sheet could not be updated —
 * the drafting workspace reconciles again on load.
 *
 * Returns true when a write happened.
 */
export async function reconcileDesignSheetPlanTrack(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  matterId: string,
  practiceArea: unknown,
): Promise<boolean> {
  try {
    const { data: sheet } = await admin
      .from('design_sheets')
      .select('id, decisions')
      .eq('matter_id', matterId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!sheet?.id) return false

    const { decisions } = reconcilePlanTrackDecisions({
      sheet: sheet as Pick<DesignSheet, 'decisions'>,
      practiceArea,
      intake: await loadIntakeTrackSnapshot(admin, matterId),
    })
    if (!decisions) return false

    const { error } = await admin
      .from('design_sheets')
      .update({ decisions, updated_at: new Date().toISOString() })
      .eq('id', sheet.id)

    if (error) {
      console.warn('[plan-track] design sheet reconcile failed', matterId, error.message)
      return false
    }
    return true
  } catch (error) {
    console.warn('[plan-track] design sheet reconcile threw', matterId, error)
    return false
  }
}

/**
 * Just enough of the intake to adopt the student's answers — the full
 * `fetchIntakeForMatter` join is more work than a track flip needs.
 */
async function loadIntakeTrackSnapshot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  matterId: string,
): Promise<IntakeSnapshot | null> {
  const { data: matter } = await admin
    .from('matters')
    .select('client_intake_id')
    .eq('id', matterId)
    .maybeSingle()

  const intakeId = (matter as { client_intake_id?: string | null } | null)?.client_intake_id
  if (!intakeId) return null

  const { data: intake } = await admin
    .from('client_intake')
    .select('intake_track, college_prep_details')
    .eq('id', intakeId)
    .maybeSingle()

  return (intake ?? null) as IntakeSnapshot | null
}
