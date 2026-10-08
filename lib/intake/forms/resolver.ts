import 'server-only'
import type { IntakeTrack } from '@/lib/intakeTrack'
import { compileIntakeForm, type CompiledIntakeForm } from './compiler'
import { compileBundledIntakeForm } from './definitions'
import { getTemplateRow, getVersionRow } from './repository'

/** Delivery errors deliberately carry neither stored data nor persistence details. */
export class IntakeFormUnavailableError extends Error {
  constructor() {
    super('Pinned intake form version is unavailable')
    this.name = 'IntakeFormUnavailableError'
  }
}

/** Dormant until activation: only a NULL legacy pin permits bundled resolution. */
export async function resolveIntakeForm(input: {
  formVersionId: string | null
  track: IntakeTrack
  audience: 'client' | 'staff'
}): Promise<{ source: 'bundled' | 'persistent'; versionId: string | null; form: CompiledIntakeForm }> {
  if (input.formVersionId === null) {
    const compiled = compileBundledIntakeForm(input.track, input.audience)
    if (!compiled.success) throw new Error('Bundled intake form is unavailable')
    return { source: 'bundled', versionId: null, form: compiled.form }
  }

  try {
    const version = await getVersionRow(input.formVersionId)
    if (!version || (version.status !== 'published' && version.status !== 'retired')) {
      throw new IntakeFormUnavailableError()
    }
    const template = await getTemplateRow(version.template_id)
    if (!template || version.definition.key !== template.key) throw new IntakeFormUnavailableError()
    const compiled = compileIntakeForm(version.definition, input.audience)
    if (!compiled.success) throw new IntakeFormUnavailableError()
    return { source: 'persistent', versionId: input.formVersionId, form: compiled.form }
  } catch {
    throw new IntakeFormUnavailableError()
  }
}
