import 'server-only'
import type { IntakeSectionIssue } from '@/lib/intake/legacySections'
import { getIntakeTrack } from '@/lib/intakeTrack'
import type { CompiledIntakeForm } from './compiler'
import { resolveIntakeRendererMode } from './rendererMode'

type RuntimeEnvironment = Parameters<typeof resolveIntakeRendererMode>[0]
type IntakeRecord = Record<string, unknown>
type IntakeDelivery = { rendererMode: 'legacy' } | {
  rendererMode: 'compiled'
  compiledForm: CompiledIntakeForm
}

/** Only call with a database row whose access has already been authorized. */
function storedVersionId(row: IntakeRecord): string | null {
  const value = row.form_version_id
  // Older projections and legacy rows may omit the nullable column.
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !value.trim()) throw new Error('Intake form is unavailable')
  return value
}

/** A rollback setting applies only to unpinned rows; pins always resolve exactly. */
export async function resolveIntakeDelivery(
  authorizedRow: IntakeRecord,
  audience: 'client' | 'staff',
  env: RuntimeEnvironment,
): Promise<IntakeDelivery> {
  const formVersionId = storedVersionId(authorizedRow)
  if (formVersionId === null && resolveIntakeRendererMode(env) === 'legacy') return { rendererMode: 'legacy' }
  // Keep legacy delivery importable even if compiled catalogs cannot initialize.
  const { resolveIntakeForm } = await import('./resolver')
  const { form } = await resolveIntakeForm({ formVersionId, track: getIntakeTrack(authorizedRow), audience })
  return { rendererMode: 'compiled', compiledForm: form }
}

/** Preserve the legacy rollout preflight, then select rules from the stored pin. */
export async function createIntakeSubmissionValidator(env: RuntimeEnvironment) {
  const mode = resolveIntakeRendererMode(env)
  const { getSubmissionErrors } = mode === 'legacy'
    ? await import('@/lib/intake/legacySections')
    : await import('@/lib/intakeSections')
  return async (authorizedRow: IntakeRecord, answers: IntakeRecord): Promise<IntakeSectionIssue[]> => {
    // Do not let request overlays change the version or the questionnaire track.
    const data = { ...answers, intake_track: getIntakeTrack(authorizedRow) }
    if (storedVersionId(authorizedRow) === null) return getSubmissionErrors(data)
    const delivery = await resolveIntakeDelivery(authorizedRow, 'client', { INTAKE_RENDERER_MODE: mode })
    if (delivery.rendererMode !== 'compiled') throw new Error('Intake form is unavailable')
    const { evaluateCompiledIntakeForm } = await import('./evaluator')
    return evaluateCompiledIntakeForm(delivery.compiledForm, data).submissionErrors
  }
}

/** Compute saved review flags with the same pinned sections as submission. */
export async function resolveIntakeReadiness(authorizedRow: IntakeRecord, answers: IntakeRecord) {
  if (storedVersionId(authorizedRow) === null) {
    const { getIntakeReadinessFlags } = await import('@/lib/intakeReadiness')
    return getIntakeReadinessFlags(answers)
  }
  const delivery = await resolveIntakeDelivery(authorizedRow, 'client', { INTAKE_RENDERER_MODE: 'legacy' })
  if (delivery.rendererMode !== 'compiled') throw new Error('Intake form is unavailable')
  const { getCompiledIntakeReadinessFlags } = await import('./readiness')
  return getCompiledIntakeReadinessFlags(delivery.compiledForm, { ...answers, intake_track: getIntakeTrack(authorizedRow) })
}
