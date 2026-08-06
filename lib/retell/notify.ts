import { sendEmail } from '@/lib/email/send'
import { sendProviderSmsMessage } from '@/lib/sms/provider'
import type { RetellCallRowInsert } from './normalize'
import {
  formatRetellAlertEmail,
  formatRetellAlertSms,
  parseRetellSummaryEmails,
  parseRetellSummarySmsTo,
  shouldNotifyRetellAnalyzed,
  type RetellNotifyInput,
} from './notifyFormat'

export {
  formatRetellAlertEmail,
  formatRetellAlertSms,
  parseRetellSummaryEmails,
  parseRetellSummarySmsTo,
  shouldNotifyRetellAnalyzed,
  type RetellNotifyInput,
} from './notifyFormat'

export async function notifyRetellCallAnalyzed(
  row: RetellNotifyInput,
  options?: { previousSummary?: string | null },
): Promise<void> {
  if (!shouldNotifyRetellAnalyzed(options?.previousSummary, row.summary)) {
    return
  }

  const { subject, text, html } = formatRetellAlertEmail(row)
  const emails = parseRetellSummaryEmails()

  for (const to of emails) {
    try {
      const result = await sendEmail({
        category: 'retell_call_alert',
        to,
        subject,
        text,
        html,
        useStoredTemplate: false,
      })
      if (!result.ok) {
        console.error('[retell] summary email failed', { to, error: result.error })
      }
    } catch (err) {
      console.error('[retell] summary email error', {
        to,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const smsTo = parseRetellSummarySmsTo()
  if (!smsTo) return

  try {
    const result = await sendProviderSmsMessage({
      to: smsTo,
      body: formatRetellAlertSms(row),
    })
    if (!result.ok) {
      console.error('[retell] summary SMS failed', { to: smsTo, error: result.error })
    }
  } catch (err) {
    console.error('[retell] summary SMS error', {
      to: smsTo,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Narrow a DB/upsert row into notify input. */
export function retellRowToNotifyInput(
  row: RetellCallRowInsert,
): RetellNotifyInput {
  return {
    external_call_id: row.external_call_id,
    direction: row.direction,
    status: row.status,
    from_number: row.from_number,
    to_number: row.to_number,
    participant_number: row.participant_number,
    duration_seconds: row.duration_seconds,
    summary: row.summary,
  }
}
