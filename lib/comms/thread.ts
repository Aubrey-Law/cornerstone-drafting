import { firmDateKey } from '@/lib/firmDate'

/** Timeline channels. `call` appears in the timeline but cannot be replied on. */
export type CommChannel = 'portal' | 'sms' | 'email' | 'call'
export type SendableChannel = 'portal' | 'sms' | 'email'

export interface CommunicationItem {
  id: string
  channel: CommChannel
  direction: 'inbound' | 'outbound'
  body: string
  /** Channel-specific detail: SMS status, email subject, call outcome… */
  meta?: string | null
  sender?: string | null
  created_at: string
}

/**
 * Default reply SLA: an unanswered client message goes Overdue after this
 * many hours. Callers accept an override so the threshold can move to the
 * pipeline SLA settings without touching the bucketing logic.
 */
export const DEFAULT_REPLY_SLA_HOURS = 24

const CHANNEL_ORDER: Record<CommChannel, number> = { portal: 0, sms: 1, email: 2, call: 3 }

/**
 * Merge per-channel item lists into one chronological timeline. Identical
 * timestamps sort deterministically (channel, then id) so the merged order is
 * stable across refetches.
 */
export function mergeCommunicationItems(...lists: CommunicationItem[][]): CommunicationItem[] {
  return lists.flat().sort((a, b) => {
    const at = Date.parse(a.created_at)
    const bt = Date.parse(b.created_at)
    if (at !== bt) return at - bt
    if (CHANNEL_ORDER[a.channel] !== CHANNEL_ORDER[b.channel]) {
      return CHANNEL_ORDER[a.channel] - CHANNEL_ORDER[b.channel]
    }
    return a.id.localeCompare(b.id)
  })
}

/**
 * The reply channel is locked to the newest inbound item the firm can answer
 * in kind. Calls are not sendable and portal messages are matter-only, so
 * both fall through to the next sendable inbound channel; with none, a matter
 * defaults to portal and a lead to email.
 */
export function resolveReplyChannel(
  items: CommunicationItem[],
  recordType: 'matter' | 'lead',
  opts?: { portalAvailable?: boolean },
): SendableChannel {
  // Leads never have a portal; a matter surface may also opt out (e.g. the
  // outward-channels card on the contact panel).
  const portalAvailable = (opts?.portalAvailable ?? true) && recordType === 'matter'
  const sorted = mergeCommunicationItems(items)
  for (let i = sorted.length - 1; i >= 0; i--) {
    const item = sorted[i]
    if (item.direction !== 'inbound') continue
    if (item.channel === 'call') continue
    if (item.channel === 'portal' && !portalAvailable) continue
    return item.channel
  }
  return portalAvailable ? 'portal' : 'email'
}

/**
 * Newest inbound message with no later outbound reply. Calls never demand a
 * typed reply (they fall back per `resolveReplyChannel`), but any outbound
 * touch — message, email or call back — answers the thread.
 */
export function waitingSince(items: CommunicationItem[]): string | null {
  let lastInbound = Number.NEGATIVE_INFINITY
  let lastInboundIso: string | null = null
  let lastOutbound = Number.NEGATIVE_INFINITY
  for (const item of items) {
    const at = Date.parse(item.created_at)
    if (item.direction === 'outbound') {
      if (at > lastOutbound) lastOutbound = at
    } else if (item.channel === 'portal' || item.channel === 'sms') {
      if (at > lastInbound) {
        lastInbound = at
        lastInboundIso = item.created_at
      }
    }
  }
  return lastInbound > lastOutbound ? lastInboundIso : null
}

export type ThreadBucket = 'overdue' | 'today' | 'earlier' | 'snoozed' | 'none'

export interface ThreadTriageInput {
  waiting_since: string | null
  snoozed_until: string | null
}

/**
 * Inbox grouping. Snooze wins over everything; a thread past the reply SLA is
 * Overdue; otherwise it groups by the firm-calendar day the client wrote.
 * Threads with nothing waiting return `none` and stay out of the reply queue.
 */
export function threadBucket(
  thread: ThreadTriageInput,
  now: Date = new Date(),
  slaHours: number = DEFAULT_REPLY_SLA_HOURS,
): ThreadBucket {
  if (thread.snoozed_until && Date.parse(thread.snoozed_until) > now.getTime()) {
    return 'snoozed'
  }
  if (!thread.waiting_since) return 'none'
  const waitedMs = now.getTime() - Date.parse(thread.waiting_since)
  if (waitedMs > slaHours * 60 * 60 * 1000) return 'overdue'
  return firmDateKey(thread.waiting_since) === firmDateKey(now.toISOString()) ? 'today' : 'earlier'
}

/** Compact waiting label for list rows: "35m", "5h", "2d". */
export function formatWaiting(waitingIso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(waitingIso)) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** Long-form waiting label for accessible names: "waiting 2 days". */
export function formatWaitingLong(waitingIso: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(waitingIso)) / 60_000))
  if (minutes < 60) return `waiting ${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `waiting ${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.floor(hours / 24)
  return `waiting ${days} day${days === 1 ? '' : 's'}`
}

export const CHANNEL_LABEL: Record<CommChannel, string> = {
  portal: 'Portal',
  sms: 'Text',
  email: 'Email',
  call: 'Call',
}

/** One row of the firm-wide thread list (`v_communication_threads` + state). */
export interface InboxThread {
  thread_key: string
  record_type: 'matter' | 'lead'
  matter_id: string | null
  lead_id: string | null
  display_name: string
  contact_phone: string | null
  contact_email: string | null
  matter_number: string | null
  stage: string | null
  last_channel: CommChannel
  last_direction: 'inbound' | 'outbound'
  last_preview: string | null
  last_message_at: string
  unread_count: number
  waiting_since: string | null
  snoozed_until: string | null
  archived_at: string | null
  marked_unread_at: string | null
  assigned_to: string | null
}

export function threadIsUnread(thread: Pick<InboxThread, 'unread_count' | 'marked_unread_at'>): boolean {
  return thread.unread_count > 0 || thread.marked_unread_at != null
}
