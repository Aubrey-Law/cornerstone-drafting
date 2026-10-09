import 'server-only'
import type { getAdminClient } from '@/lib/supabaseAdmin'
import { hydrateIntakeWithContacts } from '@/lib/intakeContactHydration'
import { createIntakeSubmissionValidator } from './runtime'

/** The calling server action must authorize staff before using the service client. */
export async function submitSavedPinnedIntakeRow(
  admin: ReturnType<typeof getAdminClient>,
  intakeId: string,
  expectedVersionId: string,
): Promise<Record<string, unknown>> {
  const { data: row, error } = await admin.from('client_intake').select('*').eq('id', intakeId).maybeSingle()
  if (error || !row) throw new Error('Unable to load the saved questionnaire. Reload and try again.')
  if (!row.form_version_id || row.form_version_id !== expectedVersionId) {
    throw new Error('The questionnaire version has changed. Reload before submitting.')
  }
  if (row.status === 'submitted' || row.status === 'approved') throw new Error('This intake has already been submitted.')
  const hydrated = await hydrateIntakeWithContacts(admin, row, intakeId)
  let issues
  try {
    const validate = await createIntakeSubmissionValidator({ INTAKE_RENDERER_MODE: 'legacy' })
    issues = await validate(row, hydrated)
  } catch {
    throw new Error('The pinned questionnaire is unavailable. Reload and try again.')
  }
  if (issues.length) {
    throw new Error(`Complete the saved questionnaire before submitting: ${issues.map(issue => `${issue.sectionTitle}: ${issue.message}`).join('; ')}`)
  }
  // Submit only the saved snapshot. Never flatten it through the staff form's
  // smaller schema, which would overwrite answers it cannot represent.
  let update = admin.from('client_intake').update({ status: 'submitted', intake_completed_at: new Date().toISOString() })
    .eq('id', intakeId).eq('form_version_id', expectedVersionId)
  update = row.updated_at === null ? update.is('updated_at', null) : update.eq('updated_at', row.updated_at)
  update = row.status === null ? update.is('status', null) : update.eq('status', row.status)
  const { data: submitted, error: submitError } = await update.select('id').maybeSingle()
  if (submitError || !submitted) throw new Error('The saved intake changed. Reload and review it before submitting.')
  return hydrated
}
