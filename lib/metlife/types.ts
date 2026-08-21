/** MetLife plan composition. Determines which sections and rates a claim uses. */
export const METLIFE_PLAN_TYPES = [
  'separate_trust',
  'joint_trust',
  'will_couple',
  'will_individual',
  'individual_trust',
] as const
export type MetlifePlanType = (typeof METLIFE_PLAN_TYPES)[number]

export const METLIFE_PLAN_TYPE_LABEL: Record<MetlifePlanType, string> = {
  separate_trust: 'Couple Separate Trusts',
  joint_trust: 'Couple Joint Trust',
  will_couple: 'Couple Will',
  will_individual: 'Individual Will',
  individual_trust: 'Individual Trust',
}

/** The exact Service Type strings the MetLife attorney portal accepts. */
export type MetlifeServiceType =
  | 'Power of Attorney'
  | 'Advanced Medical Directive'
  | 'Will'
  | 'Trust - No Tax Planning'
  | 'Affidavit'
  | 'Deed'

/** One billable row. Fees are integer cents so section totals never drift. */
export interface MetlifeLineItem {
  document: string
  serviceCode: string
  serviceType: MetlifeServiceType
  feeCents: number
  comment: string
}

export interface MetlifeSection {
  title: string
  items: MetlifeLineItem[]
  totalCents: number
}

/**
 * Attorney overrides for one run. Everything here is derived from the matter
 * when omitted — a value is only treated as confirmed when supplied explicitly.
 */
export interface MetlifeRunInput {
  planType?: MetlifePlanType
  memberId?: string
  memberName?: string
  spouseName?: string
  serviceStart?: string
  serviceEnd?: string
  realtyTrustCount?: number
  includeMinorGuardian?: boolean
}

export interface MetlifePreflightIssue {
  field: string
  message: string
}

/** The matter fields a claim reads. Mirrors the columns selected in the runner. */
export interface MetlifeMatterDetails {
  billingType?: unknown
  memberId?: string | null
  serviceStart?: string | null
  serviceEnd?: string | null
  workStarted?: string | null
  workFinished?: string | null
}

export interface MetlifeClaimData {
  matterId: string
  matterNumber: string | null
  planType: MetlifePlanType
  memberId: string
  memberName: string
  spouseName: string | null
  serviceStart: string
  serviceEnd: string
  dateSubmitted: string
  filePrefix: string
  sections: MetlifeSection[]
  grandTotalCents: number
  realtyTrustCount: number
  includeMinorGuardian: boolean
}

export interface MetlifeArtifact {
  kind: 'metlife_claim'
  filename: string
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  bytes: Buffer
}

export interface MetlifeAssemblyResult {
  data: MetlifeClaimData | null
  preflight: MetlifePreflightIssue[]
}

/** One numbered row of the Portal Submission Table, as the Chrome skill consumes it. */
export interface MetlifeSubmissionRow {
  index: number
  document: string
  serviceCode: string
  serviceType: MetlifeServiceType
  fee: string
  comment: string
  complete: 'Yes'
}
