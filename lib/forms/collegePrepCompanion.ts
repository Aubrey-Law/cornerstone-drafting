import 'server-only'

import { isCollegePrepIntake } from '@/lib/intakeTrack'
import { createMatterFromIntake } from '@/lib/matters/createFromIntake'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { formsDb } from './database'
import { intakeDisplayName, logMatterActivity, MatterFormsError } from './matterForms'

/**
 * Drafting a student's College Prep package from a questionnaire linked to the
 * parents' matter.
 *
 * Drafting reads only a matter's primary intake, and AGENTS.md asks that new
 * features link into drafting rather than change it. So instead of teaching the
 * design sheet to target a linked intake, this opens a companion matter whose
 * primary intake is the student's questionnaire, hired through the same path
 * as any lead (createMatterFromIntake → convert_lead_to_matter, CP practice
 * area, design-sheet seed, SLA plan). The drafting workspace then treats it as
 * any other College Prep matter.
 *
 * The link row stays on the parents' matter and records the companion, which
 * is the cross-link both Forms cards show. Calling this again returns the same
 * companion.
 */

const SUBMITTED_STATUSES = new Set(['submitted', 'approved'])

export interface CompanionMatterResult {
  matterId: string
  matterNumber: string | null
  created: boolean
  draftingPath: string
}

export async function openCollegePrepCompanionMatter(matterId: string, linkId: string, actorId: string): Promise<CompanionMatterResult> {
  const { data: link, error: linkError } = await formsDb().from('matter_linked_intakes').select('*').eq('id', linkId).eq('matter_id', matterId).maybeSingle()
  if (linkError) throw new MatterFormsError('Forms are temporarily unavailable.', 503)
  if (!link) throw new MatterFormsError('Questionnaire not found on this matter.', 404)

  if (link.companion_matter_id) {
    const { data: existing } = await formsDb().from('matters').select('id, matter_number').eq('id', link.companion_matter_id).maybeSingle()
    if (existing) return { matterId: existing.id, matterNumber: existing.matter_number ?? null, created: false, draftingPath: `/admin/drafting/${existing.id}` }
  }

  const { data: parent, error: parentError } = await formsDb().from('matters').select('id, name, matter_number, relationship_status').eq('id', matterId).maybeSingle()
  if (parentError) throw new MatterFormsError('Forms are temporarily unavailable.', 503)
  if (!parent) throw new MatterFormsError('Matter not found.', 404)
  if (parent.relationship_status !== 'hired') {
    throw new MatterFormsError('Hire this matter before drafting the student’s College Prep package.', 409)
  }

  const { data: intake, error: intakeError } = await formsDb().from('client_intake')
    .select('id, first_name, last_name, full_name, email, intake_track, status')
    .eq('id', link.client_intake_id).maybeSingle()
  if (intakeError) throw new MatterFormsError('Forms are temporarily unavailable.', 503)
  if (!intake) throw new MatterFormsError('Questionnaire not found on this matter.', 404)
  if (!isCollegePrepIntake(intake)) throw new MatterFormsError('Only a College Prep questionnaire can be drafted as a College Prep package.', 422)
  if (!SUBMITTED_STATUSES.has(intake.status ?? '')) {
    throw new MatterFormsError('Wait until the College Prep questionnaire is submitted before drafting.', 409)
  }

  // Idempotent: a retry after a half-finished run finds the matter already
  // opened for this intake and returns it with created=false.
  const hired = await createMatterFromIntake(getAdminClient(), intake.id, { actorId })
  if (!hired.ok) throw new MatterFormsError(hired.error, 409)

  const { error: updateError } = await formsDb().from('matter_linked_intakes')
    .update({ companion_matter_id: hired.matterId }).eq('id', link.id)
  if (updateError) {
    console.error('[college prep companion] cross-link failed', updateError.message)
    throw new MatterFormsError('The College Prep matter was opened but could not be linked back here. Try again.', 500)
  }

  const student = intakeDisplayName(intake)
  const parentLabel = [parent.matter_number, parent.name].filter(Boolean).join(' · ') || 'the family matter'
  await Promise.all([
    logMatterActivity(matterId, actorId, 'college_prep_companion_opened', `College Prep package opened for ${student}`, hired.matterNumber),
    logMatterActivity(hired.matterId, actorId, 'college_prep_companion_opened', 'Opened from a linked College Prep questionnaire', parentLabel),
  ])

  return { matterId: hired.matterId, matterNumber: hired.matterNumber, created: true, draftingPath: `/admin/drafting/${hired.matterId}` }
}
