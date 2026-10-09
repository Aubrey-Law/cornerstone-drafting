import 'server-only'
import { getIntakeTrack, intakeTrackLabel, type IntakeTrack } from '@/lib/intakeTrack'
import { evaluateClientForm, sanitizeClientFormAnswers, type ClientFormAnswers } from './clientFormAnswers'
import { formsDb, type ClientFormAssignmentRow, type ClientFormStatus } from './database'
import { compileClientFormVersion, intakeDisplayName, MatterFormsError } from './matterForms'

/**
 * The client side of "more than one form per matter". Every read is scoped to
 * client_intake rows the signed-in user owns (user_id or client_user_id). The
 * user id always comes from the verified session, never from the request.
 */

export interface PortalQuestionnaire {
  intakeId: string
  title: string
  personName: string
  track: IntakeTrack
  status: 'not_started' | 'in_progress' | 'submitted'
  href: string
}
export interface PortalClientForm {
  id: string
  title: string
  personName: string
  status: Exclude<ClientFormStatus, 'cancelled'>
  sentAt: string
  submittedAt: string | null
  href: string
}

type OwnedIntake = { id: string; first_name: string | null; last_name: string | null; full_name: string | null; email: string | null; intake_track: string | null; status: string | null; current_step: string | null; created_at: string }

async function ownedIntakes(userId: string): Promise<OwnedIntake[]> {
  const { data, error } = await formsDb().from('client_intake')
    .select('id, first_name, last_name, full_name, email, intake_track, status, current_step, created_at')
    .or(`user_id.eq.${userId},client_user_id.eq.${userId}`)
    .order('created_at', { ascending: true })
  if (error) throw new MatterFormsError('Forms are temporarily unavailable.', 503)
  return (data ?? []) as OwnedIntake[]
}

function questionnaireStatus(row: OwnedIntake): PortalQuestionnaire['status'] {
  if (row.status === 'submitted' || row.status === 'approved') return 'submitted'
  return row.status === 'draft' && (!row.current_step || row.current_step === 'personal') ? 'not_started' : 'in_progress'
}

/** Everything this portal user has been asked to fill in, oldest questionnaire first. */
export async function listPortalForms(userId: string): Promise<{ questionnaires: PortalQuestionnaire[]; forms: PortalClientForm[] }> {
  const intakes = await ownedIntakes(userId)
  if (!intakes.length) return { questionnaires: [], forms: [] }
  const ids = intakes.map(row => row.id)
  const { data: rows, error } = await formsDb().from('client_form_assignments').select('*')
    .in('client_intake_id', ids).neq('status', 'cancelled').order('sent_at', { ascending: false })
  if (error) throw new MatterFormsError('Forms are temporarily unavailable.', 503)
  const names = new Map(intakes.map(row => [row.id, intakeDisplayName(row)]))
  return {
    questionnaires: intakes.map(row => ({
      intakeId: row.id,
      title: `${intakeTrackLabel(getIntakeTrack(row))} questionnaire`,
      personName: names.get(row.id)!,
      track: getIntakeTrack(row),
      status: questionnaireStatus(row),
      href: `/intake?id=${row.id}`,
    })),
    forms: (rows ?? []).map(row => ({
      id: row.id, title: row.title, personName: names.get(row.client_intake_id) ?? '',
      status: row.status as PortalClientForm['status'], sentAt: row.sent_at, submittedAt: row.submitted_at, href: `/forms/${row.id}`,
    })),
  }
}

async function ownedAssignment(userId: string, assignmentId: string): Promise<ClientFormAssignmentRow> {
  const ids = (await ownedIntakes(userId)).map(row => row.id)
  if (!ids.length) throw new MatterFormsError('Form not found.', 404)
  const { data, error } = await formsDb().from('client_form_assignments').select('*').eq('id', assignmentId).in('client_intake_id', ids).maybeSingle()
  if (error) throw new MatterFormsError('Forms are temporarily unavailable.', 503)
  if (!data || data.status === 'cancelled') throw new MatterFormsError('Form not found.', 404)
  return data
}

export async function getPortalClientForm(userId: string, assignmentId: string) {
  const assignment = await ownedAssignment(userId, assignmentId)
  const { form } = await compileClientFormVersion(assignment.form_version_id)
  return {
    form,
    assignment: {
      id: assignment.id, title: assignment.title, status: assignment.status as PortalClientForm['status'],
      answers: assignment.answers, revision: assignment.revision, submittedAt: assignment.submitted_at,
    },
  }
}

/**
 * Save (and optionally submit) a client's answers. `revision` is the
 * optimistic lock: a second tab or a staff reopen in between makes the write
 * miss, and the client is asked to reload rather than overwrite.
 */
export async function savePortalClientForm(userId: string, assignmentId: string, input: { revision: number; answers: unknown; submit: boolean }) {
  const assignment = await ownedAssignment(userId, assignmentId)
  if (assignment.status === 'submitted') throw new MatterFormsError('This form has been submitted. Contact the firm to make changes.', 409)
  const { form } = await compileClientFormVersion(assignment.form_version_id)
  const answers: ClientFormAnswers = sanitizeClientFormAnswers(form, input.answers)
  if (input.submit) {
    const { issues } = evaluateClientForm(form, answers)
    if (issues.length) return { ok: false as const, issues }
  }
  const now = new Date().toISOString()
  const { data, error } = await formsDb().from('client_form_assignments').update({
    answers,
    revision: assignment.revision + 1,
    status: input.submit ? 'submitted' : 'in_progress',
    submitted_at: input.submit ? now : null,
    updated_at: now,
  }).eq('id', assignment.id).eq('revision', input.revision).neq('status', 'submitted').select('*').maybeSingle()
  if (error) throw new MatterFormsError('Could not save your answers. Please try again.', 503)
  if (!data) throw new MatterFormsError('This form changed in another window. Reload to see the latest answers.', 409)
  if (input.submit) {
    try {
      await formsDb().from('matter_activity').insert({
        matter_id: assignment.matter_id, event_type: 'client_form_submitted', title: `Form submitted: ${assignment.title}`, detail: assignment.id,
      })
    } catch (activityError) {
      console.warn('[portal forms] matter_activity client_form_submitted skipped:', activityError)
    }
  }
  return { ok: true as const, revision: data.revision, status: data.status, submittedAt: data.submitted_at }
}
