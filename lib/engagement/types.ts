import { MATTER_BILLING_TYPE_LABEL, type MatterBillingType } from '@/lib/billing/billingType'

export type EngagementPracticeArea = 'EP' | 'EP-LP' | 'Probate'
export type EngagementClientMode = 'individual' | 'couple'

/**
 * The plans an engagement can be drafted against.
 *
 * Taken from the firm's billing types rather than listed again, so a plan the
 * Billing tab accepts is a plan an engagement can name. Flat fee is not a plan,
 * and `other_legal_plan` has no name to print: the LP letter names the plan in
 * its own prose ("a member of the MetLife Legal Insurance Plan"), so an unnamed
 * plan has nothing to render there.
 */
export const ENGAGEMENT_LEGAL_PLANS = [
  'metlife', 'legalease', 'arag', 'hyatt', 'legalshield',
] as const satisfies readonly MatterBillingType[]

export type EngagementLegalPlan = (typeof ENGAGEMENT_LEGAL_PLANS)[number]

/** How the plan is named in the agreement and in the workspace. */
export function engagementLegalPlanLabel(plan: EngagementLegalPlan): string {
  return MATTER_BILLING_TYPE_LABEL[plan]
}

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
