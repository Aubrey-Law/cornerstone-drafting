import type { PipelineMatter } from '@/types/database'
import {
  resolveIntakeReviewTarget,
  type IntakeReadinessFlag,
} from '@/lib/intakeReadiness'

export type MatterNextActionTone = 'default' | 'warning' | 'success'
export type MatterNextActionKind =
  | 'send-intake'
  | 'send-engagement'
  | 'waiting-intake'
  | 'review-intake'
  | 'waiting-engagement'
  | 'resolve-review-flags'
  | 'draft'

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
  reviewFlags: IntakeReadinessFlag[] = [],
): MatterNextAction {
  const intakeStatus = matter.intake_status?.toLowerCase() ?? ''
  const intakeComplete = intakeStatus === 'completed' || intakeStatus === 'approved' || intakeStatus === 'submitted'
  const intakeSent = Boolean(matter.intake_sent_at) || intakeStatus === 'sent' || intakeComplete

  if (!intakeSent) {
    return {
      kind: 'send-intake',
      title: 'Send intake questionnaire',
      detail: 'Email the client a secure link to complete their intake before drafting.',
      href: `/admin/matters/${matter.matter_id}`,
      cta: 'Send intake',
      tone: 'warning',
    }
  }

  if (!intakeComplete) {
    return {
      kind: 'waiting-intake',
      title: 'Waiting for client intake',
      detail: 'The invite is out — follow up if the questionnaire is still incomplete.',
      href: `/admin/matters/${matter.matter_id}`,
      cta: 'Resend intake',
      tone: 'default',
    }
  }

  const engagementUnsigned = engagement && !engagement.signed
  if (engagementUnsigned && (!engagement.sentAt || engagement.status === 'declined')) {
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

  if (engagementUnsigned && engagement.sentAt) {
    return {
      kind: 'waiting-engagement',
      title: 'Awaiting engagement signature',
      detail: `Sent ${new Date(engagement.sentAt).toLocaleDateString()} — the client hasn't signed yet.`,
      href: `/admin/matters/${matter.matter_id}`,
      cta: 'Resend engagement',
      tone: 'default',
    }
  }

  if (reviewFlags.length > 0) {
    const first = resolveIntakeReviewTarget(reviewFlags[0])
    return {
      kind: 'resolve-review-flags',
      title: 'Resolve intake and design review flags',
      detail: `${reviewFlags.length} item${reviewFlags.length === 1 ? '' : 's'} need attorney review before drafting continues.`,
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
