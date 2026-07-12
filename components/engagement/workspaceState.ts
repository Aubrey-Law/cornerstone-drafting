export const ENGAGEMENT_STEPS = ['details', 'terms', 'review', 'send', 'status'] as const
export type EngagementStep = typeof ENGAGEMENT_STEPS[number]

export function engagementStep(value: string | null): EngagementStep {
  return ENGAGEMENT_STEPS.includes(value as EngagementStep) ? value as EngagementStep : 'details'
}

export function canSendReviewedRevision(input: { approvalToken: string; confirmExactRevision: boolean; revisionId: string; pdfSha256: string }): boolean {
  return Boolean(input.approvalToken.trim() && input.confirmExactRevision && input.revisionId.trim() && input.pdfSha256.trim())
}

export function isSupportedWorkspaceDefinition(input: { matterId?: string | null; leadId?: string | null; practiceArea?: string; clientMode?: string; scopeKey?: string; legalPlan?: unknown }): boolean {
  return Boolean((input.matterId || input.leadId) && input.practiceArea === 'EP' && input.clientMode === 'couple' && input.scopeKey === 'standard' && input.legalPlan === null)
}
