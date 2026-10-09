import 'server-only'
import { resolveIntakeDelivery } from './runtime'
import { buildCompiledIntakeExportSections } from './wordExport'

/** Call only after authorizing and hydrating the saved intake row. */
export async function resolvePinnedIntakeExport(row: Record<string, unknown>, audience: 'client' | 'staff') {
  if (row.form_version_id == null) throw new Error('A saved questionnaire version is required')
  const delivery = await resolveIntakeDelivery(row, audience, { INTAKE_RENDERER_MODE: 'legacy' })
  if (delivery.rendererMode !== 'compiled') throw new Error('Intake form is unavailable')
  return {
    title: delivery.compiledForm.title,
    sections: buildCompiledIntakeExportSections(delivery.compiledForm, row),
  }
}
