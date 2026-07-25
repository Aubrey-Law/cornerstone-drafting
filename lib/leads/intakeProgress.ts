import { getStepById, type IntakeRow } from '@/lib/intakeSections'

export type LeadIntakeSegment = {
  id: 'contact' | 'household' | 'assets' | 'real_estate' | 'fiduciaries' | 'wishes' | 'review'
  label: string
  complete: boolean
}

function activeStepComplete(intake: IntakeRow, id: string): boolean {
  const step = getStepById(id)
  if (!step) throw new Error(`Unknown intake step: ${id}`)
  if (step.condition && !step.condition(intake)) return true
  return step.isComplete(intake)
}

function estateWithoutRealPropertyComplete(intake: IntakeRow): boolean {
  const step = getStepById('estate')
  if (!step) throw new Error('Unknown intake step: estate')

  // Property address and value have their own segment. Preserve every other
  // estate completion requirement rather than duplicating the estate rules.
  const { real_property_address: _address, real_property_value: _value, ...estateIntake } = intake
  return step.isComplete(estateIntake)
}

function realEstateComplete(intake: IntakeRow): boolean {
  if (intake.has_real_property === false) return true
  if (intake.has_real_property !== true) return false

  const financial = financialDetails(intake)
  return Boolean(text(intake.real_property_address) || text(financial.real_property_address)) &&
    Boolean(text(intake.real_property_value) || text(financial.real_property_value))
}

function financialDetails(intake: IntakeRow): IntakeRow {
  const details = intake.financial_details
  return details && typeof details === 'object' && !Array.isArray(details)
    ? details as IntakeRow
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function getLeadIntakeProgress(intake: IntakeRow): LeadIntakeSegment[] {
  return [
    { id: 'contact', label: 'Contact', complete: activeStepComplete(intake, 'personal') },
    {
      id: 'household',
      label: 'Household',
      complete: ['family', 'spouse', 'children'].every((id) => activeStepComplete(intake, id)),
    },
    { id: 'assets', label: 'Assets', complete: estateWithoutRealPropertyComplete(intake) },
    { id: 'real_estate', label: 'Real estate', complete: realEstateComplete(intake) },
    {
      id: 'fiduciaries',
      label: 'Fiduciaries',
      complete: ['fiduciaries', 'spouse_fiduciaries', 'guardian'].every((id) => activeStepComplete(intake, id)),
    },
    { id: 'wishes', label: 'Wishes', complete: activeStepComplete(intake, 'goals') },
    { id: 'review', label: 'Review', complete: intake.status === 'submitted' || intake.status === 'approved' },
  ]
}
