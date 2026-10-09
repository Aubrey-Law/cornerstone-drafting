import 'server-only'
import { compileIntakeForm, type CompiledIntakeForm } from '@/lib/intake/forms/compiler'
import { getTemplateRow, getVersionRow, listTemplateRows, listVersionRows } from '@/lib/intake/forms/repository'
import { createStandingIntakeVersion, ensureStandingIntakeLink } from '@/lib/intake/standingLinks'
import { getIntakeTrack, type IntakeTrack } from '@/lib/intakeTrack'
import { sendEmail } from '@/lib/email/send'
import { getFirmConfig } from '@/lib/firmConfig'
import { portalUrl } from '@/lib/urls'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { formsDb, type ClientFormAssignmentRow, type ClientFormStatus } from './database'

/**
 * Everything a matter asks its clients to fill in:
 *  - its primary intake (matters.client_intake_id, the household drafting reads);
 *  - linked intakes, each a full questionnaire for another person — a student's
 *    College Prep package alongside the parents' estate plan;
 *  - client forms built in the form builder and sent to one of those people.
 */

export class MatterFormsError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

export interface MatterIntakeSummary {
  id: string
  primary: boolean
  linkId: string | null
  label: string | null
  name: string
  email: string | null
  track: IntakeTrack
  status: string | null
  sentAt: string | null
  completedAt: string | null
  hasPortalAccount: boolean
}
export interface MatterFormAssignmentSummary {
  id: string
  title: string
  status: ClientFormStatus
  recipientIntakeId: string
  recipientName: string
  sentAt: string
  submittedAt: string | null
  formVersionId: string
}
export interface ClientFormOption {
  templateId: string
  name: string
  description: string | null
  versionId: string
  version: number
}
export interface MatterFormsOverview {
  matterId: string
  intakes: MatterIntakeSummary[]
  assignments: MatterFormAssignmentSummary[]
  options: ClientFormOption[]
}

const INTAKE_COLUMNS = 'id, first_name, last_name, full_name, email, intake_track, status, intake_sent_at, intake_completed_at, user_id, client_user_id'
type IntakeRow = {
  id: string; first_name: string | null; last_name: string | null; full_name: string | null; email: string | null
  intake_track: string | null; status: string | null; intake_sent_at: string | null; intake_completed_at: string | null
  user_id: string | null; client_user_id: string | null
}

export function intakeDisplayName(row: Pick<IntakeRow, 'first_name' | 'last_name' | 'full_name' | 'email'>): string {
  return [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.full_name?.trim() || row.email?.trim() || 'Unnamed client'
}

function dbFailure(error: { message: string } | null, message = 'Forms are temporarily unavailable.'): never {
  if (error) console.error('[matter forms]', error.message)
  throw new MatterFormsError(message, 503)
}

async function loadMatter(matterId: string): Promise<{ id: string; client_intake_id: string }> {
  const { data, error } = await formsDb().from('matters').select('id, client_intake_id').eq('id', matterId).maybeSingle()
  if (error) dbFailure(error)
  if (!data?.client_intake_id) throw new MatterFormsError('Matter not found.', 404)
  return data as { id: string; client_intake_id: string }
}

async function logMatterActivity(matterId: string, actorId: string | null, eventType: string, title: string, detail: string | null) {
  try {
    await formsDb().from('matter_activity').insert({ matter_id: matterId, event_type: eventType, title, detail, actor_id: actorId })
  } catch (error) {
    console.warn(`[matter forms] matter_activity ${eventType} skipped:`, error)
  }
}

/** Published client forms staff can send, newest published version of each. */
export async function listClientFormOptions(): Promise<ClientFormOption[]> {
  const templates = (await listTemplateRows()).filter(row => row.purpose === 'client_form' && !row.archived_at)
  const options = await Promise.all(templates.map(async template => {
    const published = (await listVersionRows(template.id)).filter(row => row.status === 'published').sort((a, b) => b.version - a.version)[0]
    if (!published || published.definition.purpose !== 'client_form') return null
    return { templateId: template.id, name: template.name, description: template.description, versionId: published.id, version: published.version }
  }))
  return options.filter((option): option is ClientFormOption => option !== null).sort((a, b) => a.name.localeCompare(b.name))
}

/** The intakes on a matter: primary first, then linked in the order they were added. */
export async function listMatterIntakes(matterId: string): Promise<MatterIntakeSummary[]> {
  const matter = await loadMatter(matterId)
  const { data: links, error: linkError } = await formsDb().from('matter_linked_intakes').select('*').eq('matter_id', matterId).order('created_at')
  if (linkError) dbFailure(linkError)
  const ids = [matter.client_intake_id, ...(links ?? []).map(link => link.client_intake_id)]
  const { data: rows, error } = await formsDb().from('client_intake').select(INTAKE_COLUMNS).in('id', ids)
  if (error) dbFailure(error)
  const byId = new Map(((rows ?? []) as IntakeRow[]).map(row => [row.id, row]))
  return ids.flatMap(id => {
    const row = byId.get(id)
    if (!row) return []
    const link = (links ?? []).find(candidate => candidate.client_intake_id === id) ?? null
    return [{
      id, primary: id === matter.client_intake_id, linkId: link?.id ?? null, label: link?.label ?? null,
      name: intakeDisplayName(row), email: row.email, track: getIntakeTrack(row), status: row.status,
      sentAt: row.intake_sent_at, completedAt: row.intake_completed_at, hasPortalAccount: Boolean(row.user_id || row.client_user_id),
    }]
  })
}

export async function getMatterFormsOverview(matterId: string): Promise<MatterFormsOverview> {
  const [intakes, assignmentsResult, options] = await Promise.all([
    listMatterIntakes(matterId),
    formsDb().from('client_form_assignments').select('*').eq('matter_id', matterId).order('sent_at', { ascending: false }),
    listClientFormOptions(),
  ])
  if (assignmentsResult.error) dbFailure(assignmentsResult.error)
  const names = new Map(intakes.map(intake => [intake.id, intake.name]))
  const assignments = (assignmentsResult.data ?? []).map(row => ({
    id: row.id, title: row.title, status: row.status, recipientIntakeId: row.client_intake_id,
    recipientName: names.get(row.client_intake_id) ?? 'Former recipient', sentAt: row.sent_at, submittedAt: row.submitted_at,
    formVersionId: row.form_version_id,
  }))
  return { matterId, intakes, assignments, options }
}

export interface AddLinkedIntakeInput {
  firstName: string
  lastName: string
  email: string
  track: IntakeTrack
  label: string | null
}

/**
 * Create another person's questionnaire on this matter. `lead_status` stays
 * NULL so ensure_lead_matter() does not open a separate opportunity for it.
 */
export async function addLinkedIntake(matterId: string, actorId: string, input: AddLinkedIntakeInput): Promise<MatterIntakeSummary> {
  await loadMatter(matterId)
  const fullName = `${input.firstName} ${input.lastName}`.trim()
  const { data: intake, error } = await formsDb().from('client_intake').insert({
    first_name: input.firstName,
    last_name: input.lastName || null,
    full_name: fullName,
    email: input.email.toLowerCase(),
    intake_track: input.track,
    status: 'draft',
    current_step: 'personal',
    state: 'MA',
    is_us_citizen: true,
    intake_link_version: createStandingIntakeVersion(),
    intake_link_created_at: new Date().toISOString(),
    intake_link_revoked_at: null,
  }).select('id').single()
  if (error || !intake) dbFailure(error, 'Could not create the questionnaire.')
  const { error: linkError } = await formsDb().from('matter_linked_intakes').insert({
    matter_id: matterId, client_intake_id: intake.id, label: input.label, created_by: actorId,
  })
  if (linkError) {
    await formsDb().from('client_intake').delete().eq('id', intake.id)
    dbFailure(linkError, 'Could not add the questionnaire to this matter.')
  }
  await logMatterActivity(matterId, actorId, 'linked_intake_added', 'Questionnaire added', `${fullName} · ${input.track === 'college_prep' ? 'College Preparation Plan' : 'Estate Planning'}`)
  const added = (await listMatterIntakes(matterId)).find(row => row.id === intake.id)
  if (!added) throw new MatterFormsError('Questionnaire added; reload to see it.', 500)
  return added
}

/**
 * Take a linked questionnaire off the matter. One nobody has touched is
 * deleted outright; anything the client started or the firm sent is kept as a
 * person record and only unlinked, so no answers are lost.
 */
export async function removeLinkedIntake(matterId: string, linkId: string, actorId: string): Promise<{ deleted: boolean }> {
  const { data: link, error } = await formsDb().from('matter_linked_intakes').select('*').eq('id', linkId).eq('matter_id', matterId).maybeSingle()
  if (error) dbFailure(error)
  if (!link) throw new MatterFormsError('Questionnaire not found on this matter.', 404)
  const { data: row, error: rowError } = await formsDb().from('client_intake').select(INTAKE_COLUMNS).eq('id', link.client_intake_id).maybeSingle()
  if (rowError) dbFailure(rowError)
  const intake = row as IntakeRow | null
  const { count } = await formsDb().from('client_form_assignments').select('id', { count: 'exact', head: true }).eq('client_intake_id', link.client_intake_id)
  const untouched = intake && (intake.status ?? 'draft') === 'draft' && !intake.user_id && !intake.client_user_id && !intake.intake_sent_at && !count
  let deleted = false
  if (untouched) {
    // Other tables may hold the row (contacts, uploads); fall back to unlinking.
    const { error: deleteError } = await formsDb().from('client_intake').delete().eq('id', link.client_intake_id)
    deleted = !deleteError
  }
  if (!deleted) {
    const { error: unlinkError } = await formsDb().from('matter_linked_intakes').delete().eq('id', linkId)
    if (unlinkError) dbFailure(unlinkError, 'Could not remove the questionnaire.')
  }
  await logMatterActivity(matterId, actorId, 'linked_intake_removed', 'Questionnaire removed', intake ? intakeDisplayName(intake) : null)
  return { deleted }
}

/** Is this intake the matter's primary or one of its linked questionnaires? */
export async function intakeBelongsToMatter(matterId: string, intakeId: string): Promise<boolean> {
  const matter = await loadMatter(matterId)
  if (matter.client_intake_id === intakeId) return true
  const { data, error } = await formsDb().from('matter_linked_intakes').select('id').eq('matter_id', matterId).eq('client_intake_id', intakeId).maybeSingle()
  if (error) dbFailure(error)
  return Boolean(data)
}

/** The linked matter for an intake that is not a primary, if any. */
export async function linkedMatterForIntake(intakeId: string): Promise<string | null> {
  const { data } = await formsDb().from('matter_linked_intakes').select('matter_id').eq('client_intake_id', intakeId).maybeSingle()
  return data?.matter_id ?? null
}

export async function compileClientFormVersion(versionId: string): Promise<{ form: CompiledIntakeForm; templateId: string }> {
  const version = await getVersionRow(versionId)
  if (!version || !['published', 'retired'].includes(version.status) || version.definition.purpose !== 'client_form') {
    throw new MatterFormsError('This form version is unavailable.', 503)
  }
  const compiled = compileIntakeForm(version.definition, 'client')
  if (!compiled.success) throw new MatterFormsError('This form version is unavailable.', 503)
  return { form: compiled.form, templateId: version.template_id }
}

async function loadAssignment(matterId: string, assignmentId: string): Promise<ClientFormAssignmentRow> {
  const { data, error } = await formsDb().from('client_form_assignments').select('*').eq('id', assignmentId).eq('matter_id', matterId).maybeSingle()
  if (error) dbFailure(error)
  if (!data) throw new MatterFormsError('Form not found on this matter.', 404)
  return data
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

/**
 * Email the recipient a link into the form. Someone without a portal account
 * gets their standing intake link, which signs them up and then opens the form.
 */
async function emailClientForm(assignment: ClientFormAssignmentRow): Promise<{ url: string; email: string }> {
  const { data: recipient, error } = await formsDb().from('client_intake').select(INTAKE_COLUMNS).eq('id', assignment.client_intake_id).maybeSingle()
  if (error) dbFailure(error)
  const row = recipient as IntakeRow | null
  if (!row?.email) throw new MatterFormsError('The recipient has no email address on file.', 422)
  const formPath = `/forms/${assignment.id}`
  let url = portalUrl(formPath)
  if (!row.user_id && !row.client_user_id) {
    const link = await ensureStandingIntakeLink(getAdminClient(), row.id)
    if (link.url) url = `${link.url}&next=${encodeURIComponent(formPath)}`
  }
  const firm = getFirmConfig()
  const firstName = row.first_name?.trim() || 'there'
  const title = escapeHtml(assignment.title)
  const result = await sendEmail({
    matterId: assignment.matter_id,
    to: row.email,
    category: 'client_form_request',
    subject: `${assignment.title} — ${firm.firmName}`,
    html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>We have a short form for you to fill out: <strong>${title}</strong>.</p>
      <p>You can complete it any time from your secure portal. Your answers save as you go.</p>
      <p><a href="${url}" style="color:#1a6b72">Open the form →</a></p>
    </div>`,
    replyTo: firm.email,
    from: `${firm.attorneyShortName} <${firm.email}>`,
  })
  return { url, email: result.ok ? result.status : 'error' }
}

export async function sendClientForm(matterId: string, actorId: string, input: { templateId: string; recipientIntakeId: string }) {
  if (!(await intakeBelongsToMatter(matterId, input.recipientIntakeId))) throw new MatterFormsError('Choose someone on this matter to send the form to.', 422)
  const template = await getTemplateRow(input.templateId)
  if (!template || template.purpose !== 'client_form' || template.archived_at) throw new MatterFormsError('That form is not available to send.', 422)
  const option = (await listClientFormOptions()).find(candidate => candidate.templateId === input.templateId)
  if (!option) throw new MatterFormsError('Publish this form in the form builder before sending it.', 409)
  await compileClientFormVersion(option.versionId)
  const { data, error } = await formsDb().from('client_form_assignments').insert({
    matter_id: matterId, client_intake_id: input.recipientIntakeId, form_version_id: option.versionId, title: template.name, sent_by: actorId,
  }).select('*').single()
  if (error || !data) dbFailure(error, 'Could not send the form.')
  const delivery = await emailClientForm(data)
  await logMatterActivity(matterId, actorId, 'client_form_sent', `Form sent: ${template.name}`, delivery.url)
  return { assignmentId: data.id, ...delivery }
}

export async function resendClientForm(matterId: string, assignmentId: string, actorId: string) {
  const assignment = await loadAssignment(matterId, assignmentId)
  if (assignment.status === 'submitted' || assignment.status === 'cancelled') throw new MatterFormsError('Only forms still waiting on the client can be resent.', 409)
  const delivery = await emailClientForm(assignment)
  await logMatterActivity(matterId, actorId, 'client_form_resent', `Form resent: ${assignment.title}`, delivery.url)
  return delivery
}

export async function updateClientFormStatus(matterId: string, assignmentId: string, actorId: string, action: 'cancel' | 'reopen') {
  const assignment = await loadAssignment(matterId, assignmentId)
  const now = new Date().toISOString()
  if (action === 'cancel' && assignment.status === 'submitted') throw new MatterFormsError('A submitted form cannot be withdrawn. Reopen it instead.', 409)
  if (action === 'reopen' && assignment.status !== 'submitted') throw new MatterFormsError('Only submitted forms can be reopened.', 409)
  const patch = action === 'cancel'
    ? { status: 'cancelled' as const, cancelled_at: now, updated_at: now }
    : { status: 'in_progress' as const, submitted_at: null, updated_at: now, revision: assignment.revision + 1 }
  const { data, error } = await formsDb().from('client_form_assignments').update(patch).eq('id', assignmentId).eq('revision', assignment.revision).select('*').maybeSingle()
  if (error) dbFailure(error)
  if (!data) throw new MatterFormsError('This form just changed. Reload and try again.', 409)
  await logMatterActivity(matterId, actorId, action === 'cancel' ? 'client_form_cancelled' : 'client_form_reopened', `${action === 'cancel' ? 'Form withdrawn' : 'Form reopened'}: ${assignment.title}`, null)
  return data
}

export async function getClientFormForStaff(matterId: string, assignmentId: string) {
  const assignment = await loadAssignment(matterId, assignmentId)
  const { form } = await compileClientFormVersion(assignment.form_version_id)
  return { assignment, form }
}
