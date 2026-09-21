import { engagementTemplateFor } from '@/lib/engagement/templates'

export const ENGAGEMENT_STEPS = ['design', 'generate', 'review'] as const
export type EngagementStep = typeof ENGAGEMENT_STEPS[number]

export function engagementStep(value: string | null): EngagementStep {
  if (value === 'details' || value === 'terms') return 'design'
  if (value === 'send' || value === 'status') return 'review'
  return ENGAGEMENT_STEPS.includes(value as EngagementStep) ? value as EngagementStep : 'design'
}

export function canSendReviewedRevision(input: { approvalToken: string; confirmExactRevision: boolean; revisionId: string; pdfSha256: string }): boolean {
  return Boolean(input.approvalToken.trim() && input.confirmExactRevision && input.revisionId.trim() && input.pdfSha256.trim())
}

/**
 * Whether the reviewed workspace can draft this definition — which is exactly
 * whether a master exists for it. Asking the renderer's own table means the
 * workspace can never open on a definition that would fail at render.
 */
export function isSupportedWorkspaceDefinition(input: { matterId?: string | null; leadId?: string | null; practiceArea?: string; clientMode?: string; scopeKey?: string; legalPlan?: unknown }): boolean {
  return Boolean((input.matterId || input.leadId) && engagementTemplateFor(input))
}
