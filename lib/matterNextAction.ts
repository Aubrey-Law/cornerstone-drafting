import type { PipelineMatter } from '@/types/database'

export type MatterNextActionTone = 'default' | 'warning' | 'success'
export type MatterNextActionKind = 'send-intake' | 'waiting-intake' | 'review-intake' | 'draft'

export interface MatterNextAction {
  kind: MatterNextActionKind
  title: string
  detail: string
  href: string
  cta: string
  tone: MatterNextActionTone
}

export function computeMatterNextAction(matter: PipelineMatter): MatterNextAction {
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

  if (!intakeComplete && matter.stage === 'intake') {
    return {
      kind: 'waiting-intake',
      title: 'Waiting for client intake',
      detail: 'The invite is out — follow up if the questionnaire is still incomplete.',
      href: `/admin/matters/${matter.matter_id}`,
      cta: 'Resend intake',
      tone: 'default',
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
