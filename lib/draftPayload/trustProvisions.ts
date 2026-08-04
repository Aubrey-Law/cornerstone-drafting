import { getTrustPlanningType } from '@/lib/designSheetDocumentInclusions'
import {
  getTrustDetails,
  getTrustNameFormat,
  normalizeResidualBeneficiaryMethod,
  type ResidualBeneficiaryMethod,
  type TrustCoTrusteeDecision,
  type TrustDetailsProvisions,
  type TrustNameFormat,
} from '@/lib/designSheetTrustDetails'
import type { StaggeredTier } from '@/types/database'
import type { DesignSheetRow } from '@/lib/draftPayload/types'

export type DraftPayloadTrustNameFormat = TrustNameFormat

export interface DraftPayloadTrustProvisions extends TrustDetailsProvisions {
  spousal_funding: ReturnType<typeof getTrustPlanningType>
  restatement: boolean
  trust_protector: boolean
  trust_protector_name: string | null
  client_name_format: DraftPayloadTrustNameFormat
  spouse_name_format: DraftPayloadTrustNameFormat
  residual_beneficiary: string | null
  distribution_method: string | null
  distribution_age: number | null
  staggered_distributions: StaggeredTier[]
  remote_beneficiary: string | null
  remote_beneficiary_individual_names: string[]
  remote_beneficiary_charity_names: string[]
}

type TrustProvisionsInput = Pick<
  DesignSheetRow,
  | 'decisions'
  | 'restatement'
  | 'trust_protector'
  | 'trust_protector_name'
  | 'residual_beneficiary'
  | 'distribution_method'
  | 'distribution_age'
  | 'staggered_distributions'
  | 'remote_beneficiary'
  | 'remote_beneficiary_charities'
  | 'provision_substance_abuse'
  | 'provision_married_beneficiary'
  | 'no_contest_clause'
>

function formatTrustDateForDisplay(date: string | null | undefined): string {
  if (!date?.trim()) return '________________, 20___'
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(date.trim()) ? `${date.trim()}T00:00:00Z` : date.trim()
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return date.trim()
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
}

export function formatTrustDisplayName(
  trustName: string,
  trustDate: string | null | undefined,
  format: DraftPayloadTrustNameFormat,
): string {
  const upper = trustName.trim().toUpperCase()
  if (!upper) return ''

  const datePart = formatTrustDateForDisplay(trustDate)
  let result = format.date_style === 'dated_only'
    ? `${upper} dated ${datePart}`
    : `${upper}, U/A dated ${datePart}`

  if (format.append_amendments) {
    result += ', and any amendments thereto'
  }

  return result
}

export function trustCoTrusteesAction(decision: TrustCoTrusteeDecision | null): string {
  switch (decision) {
    case 'independent':
      return 'independent'
    case 'joint_majority':
      return 'joint'
    case 'settlor_separate_others_joint':
      return 'settlor_separate_others_joint'
    case 'omit':
      return ''
    default:
      return 'joint'
  }
}

/**
 * Map the residual beneficiary method onto the generator's descendant-distribution
 * vocabulary, or null when nothing usable is set.
 *
 * Null is deliberate: this used to fall through to `'staged'`, so a matter where
 * nobody picked a method — or where the stored value was unrecognised — still
 * generated a complete staged-distribution trust. Callers must leave the field
 * absent so the draft preflight reports it instead of emitting a distribution
 * provision the attorney never chose.
 */
export function descendantsDistributionMethod(
  residualMethod: ResidualBeneficiaryMethod | null,
  distributionMethod: string | null | undefined,
): string | null {
  const method = normalizeResidualBeneficiaryMethod(residualMethod)
    ?? normalizeResidualBeneficiaryMethod(distributionMethod)
  if (method === 'outright') return 'outright'
  if (method === 'staggered') return 'staged'
  if (method === 'trust_for_life') return 'trust_for_life'
  if (method === 'custom') return 'custom'
  return null
}

export function defaultDraftPayloadTrustProvisions(
  overrides: Partial<DraftPayloadTrustProvisions> = {},
): DraftPayloadTrustProvisions {
  return {
    ...draftPayloadTrustProvisions({
      decisions: null,
      restatement: false,
      trust_protector: false,
      trust_protector_name: null,
      residual_beneficiary: null,
      distribution_method: null,
      distribution_age: null,
      staggered_distributions: [],
      remote_beneficiary: 'heirs_at_law',
      remote_beneficiary_charities: [],
      provision_substance_abuse: 'no',
      provision_married_beneficiary: 'no',
      no_contest_clause: 'omit',
    }),
    ...overrides,
  }
}

export function draftPayloadTrustProvisions(sheet: TrustProvisionsInput): DraftPayloadTrustProvisions {
  const details = getTrustDetails(sheet)
  const substanceAbuse = details.include_substance_abuse || (sheet.provision_substance_abuse ?? '').toLowerCase() === 'yes'
  const creditorDivorce = details.include_creditor_divorce_provisions || (sheet.provision_married_beneficiary ?? '').toLowerCase() === 'yes'
  const noContest = details.include_no_contest_clause || sheet.no_contest_clause === 'include'

  return {
    ...details,
    include_substance_abuse: substanceAbuse,
    include_creditor_divorce_provisions: creditorDivorce,
    include_no_contest_clause: noContest,
    spousal_funding: getTrustPlanningType(sheet),
    restatement: sheet.restatement === true,
    trust_protector: sheet.trust_protector === true,
    trust_protector_name: sheet.trust_protector_name ?? null,
    client_name_format: getTrustNameFormat(sheet, 'client'),
    spouse_name_format: getTrustNameFormat(sheet, 'spouse'),
    residual_beneficiary: sheet.residual_beneficiary ?? null,
    // Carried only so descendantsDistributionMethod can fall back to it for sheets
    // written before trust_details became the single home. Nothing writes it now.
    distribution_method: sheet.distribution_method ?? null,
    distribution_age: sheet.distribution_age ?? null,
    staggered_distributions: Array.isArray(sheet.staggered_distributions) ? sheet.staggered_distributions : [],
    remote_beneficiary: sheet.remote_beneficiary ?? null,
    remote_beneficiary_individual_names: [],
    remote_beneficiary_charity_names: (sheet.remote_beneficiary_charities ?? [])
      .map(entry => entry.name?.trim())
      .filter((name): name is string => Boolean(name)),
  }
}
