import type { MatterStage } from '@/types/database'

export type PortalNextActionKind =
  | 'intake'
  | 'review'
  | 'requests'
  | 'message'
  | 'appointment'
  | 'account'
  | 'closed'
  | 'clear'
  | 'unavailable'
  | 'waiting'

export interface PortalNextAction {
  kind: PortalNextActionKind
  message: string
  label: string | null
  href: string | null
}

export interface PortalNextActionFacts {
  hasMatter: boolean
  intakeComplete: boolean
  matterStatus: string | null
  matterStage: MatterStage | null
  sharedDocumentCount: number
  unreadFirmMessageCount: number
  hasUpcomingAppointment: boolean
  outstandingInvoiceCount: number
  /** Things the firm has asked for that the client has not sent yet. Optional during rollout. */
  openDocumentRequestCount?: number
  factsAvailable: boolean
}

export function computePortalNextAction(facts: PortalNextActionFacts): PortalNextAction {
  const closed = facts.matterStatus === 'closed' || facts.matterStatus === 'archived' || facts.matterStage === 'closed'

  if (!closed && !facts.intakeComplete) {
    return {
      kind: 'intake',
      message: 'Finish your intake questionnaire so the firm can review your information. Your answers save as you go.',
      label: 'Continue intake',
      href: '/intake',
    }
  }

  if (!facts.factsAvailable) {
    return {
      kind: 'unavailable',
      message: 'We could not confirm your next step right now. Please retry before assuming that nothing is needed.',
      label: 'Retry',
      href: '/dashboard',
    }
  }

  if (!closed && facts.matterStage === 'client_review' && facts.sharedDocumentCount > 0) {
    return {
      kind: 'review',
      message: 'The firm has shared documents for your review. Send any questions or requested changes through Messages.',
      label: 'Review documents',
      href: '/documents',
    }
  }

  const owed = facts.openDocumentRequestCount ?? 0
  if (!closed && owed > 0) {
    return {
      kind: 'requests',
      message: owed === 1
        ? 'The firm has asked you for one document. Upload it from Documents when you have it.'
        : `The firm has asked you for ${owed} documents. Upload them from Documents as you gather them.`,
      label: 'See what we need',
      href: '/documents#requests',
    }
  }

  if (facts.unreadFirmMessageCount > 0) {
    return {
      kind: 'message',
      message: `You have ${facts.unreadFirmMessageCount} unread ${facts.unreadFirmMessageCount === 1 ? 'message' : 'messages'} from the firm.`,
      label: 'Read messages',
      href: '/messages',
    }
  }

  if (facts.hasUpcomingAppointment) {
    return {
      kind: 'appointment',
      message: 'You have an upcoming appointment with the firm.',
      label: 'View appointment',
      href: '/schedule',
    }
  }

  if (facts.outstandingInvoiceCount > 0) {
    return {
      kind: 'account',
      message: 'You have an invoice with a balance due.',
      label: 'View billing',
      href: '/account',
    }
  }

  if (closed) {
    return {
      kind: 'closed',
      message: `This matter is ${facts.matterStatus === 'archived' ? 'archived' : 'closed'}. No new action is listed for you. Your shared documents and messages remain available.`,
      label: null,
      href: null,
    }
  }

  if (!facts.hasMatter) {
    return {
      kind: 'waiting',
      message: 'Your intake has been submitted. The firm will contact you about the next step.',
      label: null,
      href: null,
    }
  }

  return {
    kind: 'clear',
    message: 'No new action is listed for you right now. The firm will contact you with the next request.',
    label: null,
    href: null,
  }
}
