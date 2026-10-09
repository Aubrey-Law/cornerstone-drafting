import { normalizeMaritalStatus } from '@aubrey-law/estate-fields/core'
import { getIntakeReadinessFlags, type IntakeReadinessFlag } from '@/lib/intakeReadiness'
import type { CompiledIntakeForm } from './compiler'
import { evaluateCompiledIntakeForm } from './evaluator'

/** Keep code-owned attorney flags, but route only to questions the saved form asks. */
export function getCompiledIntakeReadinessFlags(form: CompiledIntakeForm, data: Record<string, unknown>): IntakeReadinessFlag[] {
  const active = evaluateCompiledIntakeForm(form, data).activeSections
  return getIntakeReadinessFlags({ ...data, marital_status: normalizeMaritalStatus(data.marital_status) }).flatMap(flag => {
    const identifiers = flag.key === 'client_dob_missing' || flag.key === 'student_under_eighteen' ? ['client_dob']
      : flag.key === 'county_missing' ? ['county', 'address']
      : flag.key === 'spouse_dob_missing' ? ['spouse_details']
      : flag.key === 'hipaa_recipients_missing' ? ['college_hipaa_recipients']
      : flag.key === 'dpoa_effective_missing' ? ['college_dpoa_effective']
      : flag.key === 'guardian_missing' ? ['guardian']
      : flag.key.endsWith('_details_missing') ? ['financial_assets']
      : flag.key.startsWith('spouse_') ? ['spouse_fiduciaries']
      : ['client_fiduciaries', 'college_agents']
    const section = active.find(section => section.items.some(({ item }) => item.kind !== 'question' && identifiers.includes(item.kind === 'field' ? item.fieldId : item.blockId)))
    return section ? [{ ...flag, sectionId: section.id }] : []
  })
}
