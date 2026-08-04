import type { IntakeRow } from '@/lib/intakeSections'
import { DESIGN_SECTION_IDS, type DesignSectionId } from '@/lib/designSheet/sectionIds'

export type IntakeReadinessFlagSeverity = 'review'
export type IntakeReadinessResolutionKind = 'needs_data' | 'attorney_judgment'

export interface IntakeReadinessFlag {
  key: string
  label: string
  sectionId: string
  severity: IntakeReadinessFlagSeverity
  resolutionKind: IntakeReadinessResolutionKind
  message: string
}

export interface IntakeReviewTarget {
  sectionId: DesignSectionId
  targetField: string | null
  href: (matterId: string) => string
}

type ReviewChoice = 'discuss_with_attorney' | 'not_provided_yet'

const FIDUCIARY_FLAG_LABELS: Array<{
  key: string
  entryKey: string
  label: string
  sectionId: string
  choiceKey: string
}> = [
  {
    key: 'client_trustee_missing',
    entryKey: 'fid_trustee_client',
    label: 'Trustee',
    sectionId: 'fiduciaries',
    choiceKey: 'fiduciaries',
  },
  {
    key: 'client_personal_rep_missing',
    entryKey: 'fid_personal_rep_client',
    label: 'Personal Representative',
    sectionId: 'fiduciaries',
    choiceKey: 'fiduciaries',
  },
  {
    key: 'client_poa_missing',
    entryKey: 'fid_poa_client',
    label: 'Financial Power of Attorney',
    sectionId: 'fiduciaries',
    choiceKey: 'fiduciaries',
  },
  {
    key: 'client_hcp_missing',
    entryKey: 'fid_hcp_client',
    label: 'Health Care Proxy',
    sectionId: 'fiduciaries',
    choiceKey: 'fiduciaries',
  },
  {
    key: 'spouse_personal_rep_missing',
    entryKey: 'fid_personal_rep_spouse',
    label: "Spouse's Personal Representative",
    sectionId: 'spouse_fiduciaries',
    choiceKey: 'spouse_fiduciaries',
  },
  {
    key: 'spouse_poa_missing',
    entryKey: 'fid_poa_spouse',
    label: "Spouse's Financial Power of Attorney",
    sectionId: 'spouse_fiduciaries',
    choiceKey: 'spouse_fiduciaries',
  },
  {
    key: 'spouse_hcp_missing',
    entryKey: 'fid_hcp_spouse',
    label: "Spouse's Health Care Proxy",
    sectionId: 'spouse_fiduciaries',
    choiceKey: 'spouse_fiduciaries',
  },
]

export function getIntakeReadinessFlags(data: IntakeRow): IntakeReadinessFlag[] {
  const flags: IntakeReadinessFlag[] = []
  const married = text(data, 'marital_status') === 'married'
  const minorChildren = data.has_minor_children === true

  if (!text(data, 'date_of_birth')) {
    flags.push(flag('client_dob_missing', 'Client date of birth', 'personal', 'Client date of birth was not provided.'))
  }

  if (married && !spouseText(data, 'date_of_birth')) {
    flags.push(flag('spouse_dob_missing', 'Spouse date of birth', 'spouse', 'Spouse date of birth was not provided.'))
  }

  if (!text(data, 'county')) {
    flags.push(flag('county_missing', 'County', 'personal', 'County was not provided; confirm if real estate or deed work is involved.'))
  }

  for (const item of FIDUCIARY_FLAG_LABELS) {
    if (item.entryKey.endsWith('_spouse') && !married) continue
    if (hasNamedFiduciary(data, item.entryKey)) continue
    const choice = reviewChoice(data, item.choiceKey)
    flags.push(flag(
      item.key,
      item.label,
      item.sectionId,
      readinessMessage(`${item.label} was not provided.`, choice),
      choice === 'discuss_with_attorney' ? 'attorney_judgment' : 'needs_data',
    ))
  }

  if (minorChildren && !hasNamedFiduciary(data, 'fid_guardian_client')) {
    const choice = reviewChoice(data, 'guardian')
    flags.push(flag(
      'guardian_missing',
      'Guardian for minor children',
      'guardian',
      readinessMessage('Guardian for minor children was not provided.', choice),
      choice === 'discuss_with_attorney' ? 'attorney_judgment' : 'needs_data',
    ))
  }

  flags.push(...assetDetailFlags(data))
  return flags
}

function assetDetailFlags(data: IntakeRow): IntakeReadinessFlag[] {
  const financial = nestedRecord(data, 'financial_details')
  const assetTypes = arrayValue(data, 'asset_types')
    .concat(arrayValue(financial, 'asset_types'))
    .filter((value): value is string => typeof value === 'string')

  const uniqueAssets = Array.from(new Set(assetTypes))
  const flags: IntakeReadinessFlag[] = []

  if (uniqueAssets.includes('real_estate') && !hasRealEstateDetails(financial, data)) {
    flags.push(flag('real_estate_details_missing', 'Real estate details', 'estate', 'Real estate was selected, but property details were not provided.'))
  }

  for (const asset of uniqueAssets) {
    if (asset === 'real_estate') continue
    if (hasAssetDetails(financial[asset] ?? data[`financial_${asset}`])) continue
    flags.push(flag(`${asset}_details_missing`, `${prettyAssetName(asset)} details`, 'estate', `${prettyAssetName(asset)} was selected, but details were not provided.`))
  }

  return flags
}

function flag(
  key: string,
  label: string,
  sectionId: string,
  message: string,
  resolutionKind: IntakeReadinessResolutionKind = 'needs_data',
): IntakeReadinessFlag {
  return { key, label, sectionId, severity: 'review', resolutionKind, message }
}

const INTAKE_REVIEW_TARGETS: Record<string, { sectionId: DesignSectionId; targetField: string | null }> = {
  client_dob_missing: { sectionId: DESIGN_SECTION_IDS.clientInformation, targetField: 'client_dob' },
  spouse_dob_missing: { sectionId: DESIGN_SECTION_IDS.clientInformation, targetField: 'spouse_dob' },
  county_missing: { sectionId: DESIGN_SECTION_IDS.clientInformation, targetField: 'county' },
  client_trustee_missing: { sectionId: DESIGN_SECTION_IDS.trustDetails, targetField: 'trustee_slots' },
  client_personal_rep_missing: { sectionId: DESIGN_SECTION_IDS.willDetails, targetField: 'executor_slots' },
  spouse_personal_rep_missing: { sectionId: DESIGN_SECTION_IDS.willDetails, targetField: 'spouse_executor_slots' },
  guardian_missing: { sectionId: DESIGN_SECTION_IDS.willDetails, targetField: 'guardian_slots' },
  client_poa_missing: { sectionId: DESIGN_SECTION_IDS.financialPoa, targetField: 'poa_slots' },
  spouse_poa_missing: { sectionId: DESIGN_SECTION_IDS.financialPoa, targetField: 'spouse_poa_slots' },
  client_hcp_missing: { sectionId: DESIGN_SECTION_IDS.healthcareDirectives, targetField: 'hcp_slots' },
  spouse_hcp_missing: { sectionId: DESIGN_SECTION_IDS.healthcareDirectives, targetField: 'spouse_hcp_slots' },
}

export function resolveIntakeReviewTarget(flag: Pick<IntakeReadinessFlag, 'key'>): IntakeReviewTarget {
  const mapped = INTAKE_REVIEW_TARGETS[flag.key]
    ?? (flag.key.endsWith('_details_missing')
      ? { sectionId: DESIGN_SECTION_IDS.assetSchedules, targetField: null }
      : { sectionId: DESIGN_SECTION_IDS.intakeReview, targetField: null })

  return {
    ...mapped,
    href(matterId: string) {
      const focus = `${mapped.sectionId}:${mapped.targetField ?? ''}`
      return `/admin/drafting/${matterId}?step=design&focus=${encodeURIComponent(focus)}`
    },
  }
}

function readinessMessage(base: string, choice: ReviewChoice | null): string {
  if (choice === 'discuss_with_attorney') return `${base} Client chose to discuss this with the attorney.`
  if (choice === 'not_provided_yet') return `${base} Client marked this as not provided yet.`
  return `${base} Attorney review needed.`
}

function reviewChoice(data: IntakeRow, key: string): ReviewChoice | null {
  const choices = reviewChoices(data)
  const choice = choices[key]
  return choice === 'discuss_with_attorney' || choice === 'not_provided_yet' ? choice : null
}

function reviewChoices(data: IntakeRow): Record<string, unknown> {
  const local = data._review_choices
  if (local && typeof local === 'object' && !Array.isArray(local)) {
    return local as Record<string, unknown>
  }
  // Read from the dedicated client_intake.review_choices column (added in F4a).
  const stored = data.review_choices
  return stored && typeof stored === 'object' && !Array.isArray(stored)
    ? stored as Record<string, unknown>
    : {}
}

function hasNamedFiduciary(data: IntakeRow, key: string): boolean {
  return getFiduciaryEntries(data, key).some((entry) => text(entry, 'first_name') && text(entry, 'last_name'))
}

function getFiduciaryEntries(data: IntakeRow, key: string): IntakeRow[] {
  const local = data[`_${key}`]
  if (Array.isArray(local)) return local.filter(isRecord)
  const stored = nestedRecord(data, 'fiduciary_entries')[key]
  return Array.isArray(stored) ? stored.filter(isRecord) : []
}

function hasRealEstateDetails(financial: Record<string, unknown>, data: IntakeRow): boolean {
  const realEstate = financial.real_estate ?? data.financial_real_estate
  if (!Array.isArray(realEstate)) return false
  return realEstate.some((item) => {
    if (!isRecord(item)) return false
    return Boolean(text(item, 'address') || text(item, 'street') || text(item, 'estimatedValue') || text(item, 'estimated_value'))
  })
}

function hasAssetDetails(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (isRecord(value)) {
    return Object.values(value).some((part) => {
      if (typeof part === 'string') return part.trim().length > 0
      if (typeof part === 'number') return true
      if (Array.isArray(part)) return part.length > 0
      return false
    })
  }
  return false
}

function spouseText(data: IntakeRow, key: string): string {
  const spouse = data._spouse
  if (isRecord(spouse)) {
    const local = text(spouse, key)
    if (local) return local
  }
  return text(data, `spouse_${key}`)
}

function nestedRecord(data: IntakeRow, key: string): Record<string, unknown> {
  const value = data[key]
  return isRecord(value) ? value : {}
}

function arrayValue(data: IntakeRow, key: string): unknown[] {
  const value = data[key]
  return Array.isArray(value) ? value : []
}

function text(data: IntakeRow, key: string): string {
  return typeof data[key] === 'string' ? data[key].trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function prettyAssetName(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

/**
 * Whether a fiduciary slot array has anybody named in it.
 * Co-fiduciaries alone do not count: a co-agent qualifies the principal choice
 * rather than being one, so a slot array holding only co-entries is still unnamed.
 */
function slotIsNamed(slots: unknown): boolean {
  return Array.isArray(slots)
    && slots.some(slot =>
      typeof slot === 'object' && slot !== null
      && !(slot as { is_co?: boolean }).is_co
      && Boolean((slot as { contact_id?: string | null }).contact_id))
}

function sheetText(sheet: Record<string, unknown>, key: string): boolean {
  const value = sheet[key]
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value)
}

/**
 * Does the design sheet now answer what intake left blank?
 *
 * Keyed by flag. Anything absent here has no design-sheet equivalent and so can
 * only be resolved on the intake side.
 */
const REVIEW_FLAG_SATISFIED_BY: Record<string, (sheet: Record<string, unknown>) => boolean> = {
  client_dob_missing: sheet => sheetText(sheet, 'client_dob'),
  spouse_dob_missing: sheet => sheetText(sheet, 'spouse_dob'),
  county_missing: sheet => sheetText(sheet, 'county'),

  client_trustee_missing: sheet => slotIsNamed(sheet.trustee_slots),
  // "Same as trustee" is an answer, so the trustee choice satisfies these too.
  client_personal_rep_missing: sheet =>
    slotIsNamed(sheet.executor_slots)
    || (sheet.executor_same_as_trustee === true && slotIsNamed(sheet.trustee_slots)),
  client_poa_missing: sheet =>
    slotIsNamed(sheet.poa_slots)
    || (sheet.poa_same_as_trustee === true && slotIsNamed(sheet.trustee_slots)),
  client_hcp_missing: sheet => slotIsNamed(sheet.hcp_slots),

  spouse_personal_rep_missing: sheet =>
    slotIsNamed(sheet.spouse_executor_slots)
    || (sheet.spouse_executor_same_as_trustee === true && slotIsNamed(sheet.spouse_trustee_slots)),
  spouse_poa_missing: sheet => slotIsNamed(sheet.spouse_poa_slots),
  spouse_hcp_missing: sheet => slotIsNamed(sheet.spouse_hcp_slots),

  guardian_missing: sheet => slotIsNamed(sheet.guardian_slots),
}

/**
 * Drop review flags the design sheet has since answered.
 *
 * `getIntakeReadinessFlags` describes the *intake submission*, and its result is
 * frozen onto `design_sheets.intake_review_flags` when the sheet is seeded. Nothing
 * recomputed it, so naming a fiduciary in the design sheet — which writes
 * `<role>_slots`, not the intake row — left the flag showing forever. Resolving at
 * read time makes the flags derived, so they clear themselves; the stored snapshot
 * stays as the record of what intake originally provided.
 */
export function resolveIntakeReviewFlags(
  flags: IntakeReadinessFlag[],
  sheet: Record<string, unknown> | null | undefined,
): IntakeReadinessFlag[] {
  if (!sheet) return flags
  return flags.filter(flag => {
    const satisfied = REVIEW_FLAG_SATISFIED_BY[flag.key]
    return !satisfied || !satisfied(sheet)
  })
}
