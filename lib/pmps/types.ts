import type { DraftPayload } from '@/lib/draftPayload/types'

export const PMPS_ARTIFACT_KINDS = ['agenda', 'proposal', 'tax_worksheet', 'one_page_summary'] as const
export type PmpsArtifactKind = typeof PMPS_ARTIFACT_KINDS[number]
export type PmpsPlanStructure = 'joint_outright' | 'joint_disclaimer' | 'separate_clayton' | 'individual_single'

export interface PmpsRunInput {
  hasLegalPlan?: boolean
  legalPlanName?: string
  flatFee?: number
  planStructure?: PmpsPlanStructure
  documentKinds?: PmpsArtifactKind[]
}

export interface PmpsPreflightIssue {
  field: string
  message: string
}

export interface PmpsClient {
  fullName: string
  firstName: string
  lastName: string
  dob: string | null
}

export interface PmpsData {
  matterId: string
  matterNumber: string | null
  date: string
  filePrefix: string
  clients: { type: 'couple' | 'individual'; client: PmpsClient; spouse: PmpsClient | null }
  children: DraftPayload['children']
  assets: NonNullable<DraftPayload['assets']>
  grossEstate: number
  fiduciaries: DraftPayload['fiduciaries']
  documents: DraftPayload['documents']
  hasLegalPlan: boolean
  legalPlanName: string | null
  flatFee: number | null
  planStructure: PmpsPlanStructure
}

export interface PmpsArtifact {
  kind: PmpsArtifactKind
  filename: string
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  bytes: Buffer
}

export interface PmpsAssemblyResult {
  data: PmpsData | null
  preflight: PmpsPreflightIssue[]
  selectedKinds: PmpsArtifactKind[]
}
