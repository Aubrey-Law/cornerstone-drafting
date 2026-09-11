import { newestTimestamp } from '@/lib/leads/timeline'

type ContactActivity = {
  event_type?: string | null
  title?: string | null
  detail?: string | null
  created_at: string
}

const RESPONSE_EVENTS = new Set(['email_received', 'sms_received'])
const CONTACT_EVENTS = new Set(['call_connected', 'email_sent', 'sms_sent', 'intake_sent', 'engagement_sent', ...RESPONSE_EVENTS])

/** Only explicit communication events advance the client contact clock.
 * Record edits, notes and intake completion (which staff can do) are not evidence
 * of speaking with the client. Unknown historical event types remain unclassified.
 */
export function clientContactTimestamps(activity: readonly ContactActivity[]) {
  return {
    lastClientContactAt: newestTimestamp(activity
      .filter(row => CONTACT_EVENTS.has(row.event_type ?? '')
        && !(row.event_type === 'sms_sent' && /^Text failed\b/i.test(row.title ?? ''))
        && !(row.event_type === 'email_sent' && /·\s*(suppressed|logged|redirected)\b/i.test(row.detail ?? '')))
      .map(row => row.created_at)),
    lastClientResponseAt: newestTimestamp(activity
      .filter(row => RESPONSE_EVENTS.has(row.event_type ?? ''))
      .map(row => row.created_at)),
  }
}
