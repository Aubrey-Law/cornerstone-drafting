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
  return step.isComplete(normalizeAssetSelection(estateIntake))
}

const ADMIN_ASSET_FLAGS = [
  ['has_real_property', 'real_estate'],
  ['has_retirement', 'retirement'],
  ['has_investments', 'investments'],
  ['has_business', 'business'],
  ['has_life_insurance', 'life_insurance'],
] as const

function normalizeAssetSelection(intake: IntakeRow): IntakeRow {
  const financial = financialDetails(intake)
  const explicitAssetTypes = assetTypesFor(intake, financial)
  if (explicitAssetTypes !== null) return { ...intake, asset_types: explicitAssetTypes }

  const hasAdminAssetShape = ADMIN_ASSET_FLAGS.some(([flag]) =>
    Object.prototype.hasOwnProperty.call(intake, flag))
  if (!hasAdminAssetShape) return intake

  return {
    ...intake,
    asset_types: ADMIN_ASSET_FLAGS
      .filter(([flag]) => intake[flag] === true)
      .map(([, assetType]) => assetType),
  }
}

function realEstateComplete(intake: IntakeRow): boolean {
  if (intake.has_real_property === false) return true
  if (intake.has_real_property === true) {
    const financial = financialDetails(intake)
    return Boolean(text(intake.real_property_address) || text(financial.real_property_address)) &&
      Boolean(text(intake.real_property_value) || text(financial.real_property_value))
  }

  const financial = financialDetails(intake)
  const assetTypes = assetTypesFor(intake, financial)
  if (Object.prototype.hasOwnProperty.call(intake, 'has_real_property') && !Array.isArray(financial.asset_types)) {
    return false
  }
  if (!assetTypes) return false
  if (!assetTypes.includes('real_estate')) return true

  const properties = realEstateItems(intake, financial)
  return properties.length > 0 && properties.every((property) =>
    Boolean(text(property.address) || text(property.street)) &&
    hasValue(property.value ?? property.estimatedValue ?? property.estimated_value),
  )
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

function assetTypesFor(intake: IntakeRow, financial: IntakeRow): string[] | null {
  const raw = Array.isArray(financial.asset_types)
    ? financial.asset_types
    : Array.isArray(intake.asset_types) ? intake.asset_types : null
  return raw?.filter((asset): asset is string => typeof asset === 'string') ?? null
}

function realEstateItems(intake: IntakeRow, financial: IntakeRow): IntakeRow[] {
  const raw = Array.isArray(financial.real_estate)
    ? financial.real_estate
    : Array.isArray(intake.financial_real_estate) ? intake.financial_real_estate : []
  return raw.filter((item): item is IntakeRow => !!item && typeof item === 'object' && !Array.isArray(item))
}

function hasValue(value: unknown): boolean {
  return typeof value === 'number' ? Number.isFinite(value) : Boolean(text(value))
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
