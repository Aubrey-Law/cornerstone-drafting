import type { PipelineMatter } from '@/types/database'
import {
  resolveIntakeReviewTarget,
  type IntakeReadinessFlag,
} from '@/lib/intakeReadiness'
import { evaluateMatterRequirements } from '@/lib/lifecycle/matter'

export type MatterNextActionTone = 'default' | 'warning' | 'success'
export type MatterNextActionKind =
  | 'send-intake'
  | 'send-engagement'
  | 'waiting-intake'
  | 'review-intake'
  | 'waiting-engagement'
  | 'resolve-review-flags'
  | 'draft'
  | 'closed'
  | 'review'
  | 'revise'
  | 'signing'
  | 'follow-up'

export interface MatterNextAction {
  kind: MatterNextActionKind
  title: string
  detail: string
  href: string
  cta: string
  tone: MatterNextActionTone
}

/** Engagement e-sign state, when the caller has matter_details loaded. */
export interface EngagementSnapshot {
  signed: boolean
  sentAt: string | null
  status: string | null
}

export function computeMatterNextAction(
  matter: PipelineMatter,
  engagement?: EngagementSnapshot,
  reviewFlags?: IntakeReadinessFlag[],
): MatterNextAction {
  if (matter.status === 'closed' || matter.status === 'archived' || matter.stage === 'closed') {
    return {
      kind: 'closed',
      title: matter.status === 'archived' ? 'Matter archived' : 'Matter closed',
      detail: 'Review retained documents, messages, and any remaining account items.',
      href: `/admin/matters/${matter.matter_id}?tab=documents`,
      cta: 'View documents',
      tone: 'default',
    }
  }

  // Later lifecycle stages remain useful even when historical intake metadata is incomplete.
  if (matter.stage === 'client_review' || matter.stage === 'revision') {
    const revising = matter.stage === 'revision'
    return {
      kind: revising ? 'revise' : 'review',
      title: revising ? 'Address requested revisions' : 'Follow up on client review',
      detail: revising
        ? 'Review the requested changes in the drafting workspace.'
        : 'Check the reviewed drafts and client feedback before advancing the matter.',
      href: `/admin/drafting/${matter.matter_id}?step=review`,
      cta: revising ? 'Review revisions' : 'Review drafts',
      tone: 'default',
    }
  }
  if (matter.stage === 'drafts_approved' || matter.stage === 'signing_scheduled') {
    return {
      kind: 'signing',
      title: matter.stage === 'drafts_approved' ? 'Prepare for signing' : 'Review signing preparation',
      detail: 'Review the signing tasks and scheduled date before the appointment.',
      href: `/admin/matters/${matter.matter_id}?tab=tasks`,
      cta: 'Open signing tasks',
      tone: 'default',
    }
  }
  if (['signing_complete', 'post_execution', 'funding'].includes(matter.stage)) {
    return {
      kind: 'follow-up',
      title: 'Complete post-signing follow-up',
      detail: 'Review the remaining execution, delivery, and funding tasks recorded for this matter.',
      href: `/admin/matters/${matter.matter_id}?tab=tasks`,
      cta: 'Review remaining tasks',
      tone: 'default',
    }
  }

  const requirements = evaluateMatterRequirements(matter, engagement, reviewFlags)
  const unmet = new Map(requirements.filter(item => !item.satisfied).map(item => [item.key, item]))

  if (unmet.has('matter.intake_sent')) {
    return {
      kind: 'send-intake',
      title: 'Send intake questionnaire',
      detail: 'Email the client a secure link to complete their intake before drafting.',
      href: `/admin/matters/${matter.matter_id}`,
      cta: 'Send intake',
      tone: 'warning',
    }
  }

  if (unmet.has('matter.intake_complete')) {
    return {
      kind: 'waiting-intake',
      title: 'Waiting for client intake',
      detail: 'The invite is out — follow up if the questionnaire is still incomplete.',
      href: `/admin/matters/${matter.matter_id}`,
      cta: 'Resend intake',
      tone: 'default',
    }
  }

  const engagementUnsigned = unmet.has('matter.engagement_signed')
  if (engagement && engagementUnsigned && (!engagement.sentAt || engagement.status === 'declined')) {
    return {
      kind: 'send-engagement',
      title: 'Send engagement agreement',
      detail:
        engagement.status === 'declined'
          ? 'The client declined the last engagement — review and resend it for signature.'
          : 'Email the client the engagement agreement to sign before work begins.',
      href: `/admin/matters/${matter.matter_id}`,
      cta: 'Send engagement',
      tone: 'warning',
    }
  }

  if (engagement && engagementUnsigned && engagement.sentAt) {
    return {
      kind: 'waiting-engagement',
      title: 'Awaiting engagement signature',
      detail: `Sent ${new Date(engagement.sentAt).toLocaleDateString()} — the client hasn't signed yet.`,
      href: `/admin/matters/${matter.matter_id}`,
      cta: 'Resend engagement',
      tone: 'default',
    }
  }

  if (unmet.has('matter.review_flags_resolved') && reviewFlags?.length) {
    const first = resolveIntakeReviewTarget(reviewFlags[0])
    return {
      kind: 'resolve-review-flags',
      title: 'Resolve intake and design review flags',
      detail: `${reviewFlags.length} item${reviewFlags.length === 1 ? '' : 's'} need attorney review before relying on the drafts.`,
      href: first.href(matter.matter_id),
      cta: 'Resolve review flags',
      tone: 'warning',
    }
  }

  if (matter.stage === 'intake_review') {
    return {
      kind: 'review-intake',
      title: 'Review submitted intake',
      detail: 'The client finished their questionnaire — review answers and open drafting.',
      href: `/admin/drafting/${matter.matter_id}`,
      cta: 'Open drafting',
      tone: 'success',
    }
  }

  return {
    kind: 'draft',
    title: 'Open drafting workspace',
    detail: 'Complete the design sheet, generate drafts, and share reviewed documents.',
    href: `/admin/drafting/${matter.matter_id}`,
    cta: 'Open drafting',
    tone: 'default',
  }
}

export function matterDaysOpen(matterCreated: string | null | undefined): number {
  if (!matterCreated) return 0
  const start = Date.parse(matterCreated)
  if (Number.isNaN(start)) return 0
  return Math.max(0, Math.floor((Date.now() - start) / 86_400_000))
}
