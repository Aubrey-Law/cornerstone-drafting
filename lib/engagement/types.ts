export type EngagementPracticeArea = 'EP' | 'EP-LP' | 'Probate'
export type EngagementClientMode = 'individual' | 'couple'
export type EngagementLegalPlan = 'MetLife' | 'LegalEase' | 'ARAG'
export type EngagementStatus =
  | 'draft'
  | 'ready'
  | 'sent'
  | 'viewed'
  | 'partially_signed'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'failed'

export interface EngagementRecipientInput {
  name: string
  email: string
}

export interface EngagementClauseSnapshot {
  id?: string | null
  title: string
  text: string
  source: 'library' | 'ai' | 'manual'
  aiProvenance?: { mode: 'draft' | 'revise'; acceptedAt: string } | null
}

export interface EngagementInput {
  practiceArea: EngagementPracticeArea
  clientMode: EngagementClientMode
  agreementDate: string
  primary: EngagementRecipientInput
  spouse: EngagementRecipientInput | null
  legalPlan: EngagementLegalPlan | null
  fee: {
    amount: number
    paymentTerms: string
  }
  scopeKey: string
  optionalClauseKeys: string[]
  additionalClauses?: EngagementClauseSnapshot[]
  scheduleAClauses?: EngagementClauseSnapshot[]
  emailMessage: string
  expirationHours: number
}
