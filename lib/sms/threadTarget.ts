import type { ResolvedSmsTarget } from '@/lib/sms/outbound'
import { MAX_LEAD_SMS_BODY_LENGTH, MAX_SMS_BODY_LENGTH } from '@/lib/sms/constants'
import type { SmsThread, SmsThreadKind, SmsThreadLink } from '@/lib/queries/smsThreads'

export interface ThreadSendContext {
  /** 10-digit phone key. */
  phone: string
  thread: SmsThread | null
  /** Record picked in "New text", for a number with no conversation yet. */
  link?: (SmsThreadLink & { name?: string | null }) | null
}

function kindFromLink(link: SmsThreadLink): SmsThreadKind {
  if (link.contactId) return 'contact'
  if (link.leadId) return 'lead'
  if (link.matterId) return 'client'
  return 'unknown'
}

export function formatUsPhone(key: string): string {
  return key.length === 10 ? `(${key.slice(0, 3)}) ${key.slice(3, 6)}-${key.slice(6)}` : key
}

/**
 * Who a Texts-page reply goes to. Always the conversation's own number, not
 * whatever phone the linked record holds now — the reply belongs in the
 * thread the person texted from.
 */
export function threadSendTarget({ phone, thread, link }: ThreadSendContext): {
  target: ResolvedSmsTarget
  kind: SmsThreadKind
  maxLength: number
} {
  const ids: SmsThreadLink = thread
    ? { leadId: thread.leadId, matterId: thread.matterId, contactId: thread.contactId }
    : { leadId: link?.leadId ?? null, matterId: link?.matterId ?? null, contactId: link?.contactId ?? null }
  const kind = thread?.kind ?? kindFromLink(ids)
  const name = thread?.name ?? link?.name?.trim() ?? null

  return {
    kind,
    maxLength: kind === 'lead' ? MAX_LEAD_SMS_BODY_LENGTH : MAX_SMS_BODY_LENGTH,
    target: {
      recipientName: name || formatUsPhone(phone),
      recipientRole: kind === 'lead' || kind === 'client' ? 'client' : 'other',
      phone: `+1${phone}`,
      matterId: ids.matterId ?? null,
      // A client's texts log to the matter timeline, not the old lead's.
      leadId: kind === 'client' ? null : ids.leadId ?? null,
      contactId: ids.contactId ?? null,
    },
  }
}
