import type { IntakeRow } from '@/lib/intakeSections'
import type { IntakeTrack } from '@/lib/intakeTrack'
import { compileIntakeForm } from '../compiler'
import { evaluateCompiledIntakeForm } from '../evaluator'
import { COLLEGE_PREP_INTAKE_FORM } from './collegePrep'
import { ESTATE_INTAKE_FORM } from './estate'

export { COLLEGE_PREP_INTAKE_FORM, ESTATE_INTAKE_FORM }

export function getBundledIntakeForm(track: IntakeTrack) {
  return track === 'college_prep' ? COLLEGE_PREP_INTAKE_FORM : ESTATE_INTAKE_FORM
}

export function compileBundledIntakeForm(track: IntakeTrack, audience: 'client' | 'staff') {
  return compileIntakeForm(getBundledIntakeForm(track), audience)
}

/** Bundled configuration bugs fail closed rather than substituting a questionnaire. */
export function evaluateBundledIntakeForm(track: IntakeTrack, audience: 'client' | 'staff', data: IntakeRow) {
  const compiled = compileBundledIntakeForm(track, audience)
  if (!compiled.success) throw new Error(`Invalid bundled intake form ${track}: ${compiled.errors.map(({ path, message }) => `${path}: ${message}`).join('; ')}`)
  return evaluateCompiledIntakeForm(compiled.form, { ...data, intake_track: track })
}
