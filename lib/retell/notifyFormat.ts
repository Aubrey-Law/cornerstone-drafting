import { MAX_SMS_BODY_LENGTH } from '@/lib/sms/constants'
import { formatPhoneDisplay } from '@/lib/phone'
import { appUrl } from '@/lib/urls'

const DEFAULT_SUMMARY_EMAIL = 'scott@aubreylegal.com'
const SMS_EXTENSION_PATTERN = /\b(?:ext\.?|extension|x)\s*[0-9][0-9 .-]*$/i

export interface RetellNotifyInput {
  external_call_id: string
  direction: 'inbound' | 'outbound'
  status: string
  from_number: string
  to_number: string
  participant_number: string
  duration_seconds: number | null
  summary: string | null
  matter_id?: string | null
  lead_id?: string | null
}

export function parseRetellSummaryEmails(
  raw: string | null | undefined = process.env.RETELL_SUMMARY_TO,
): string[] {
  const source = raw?.trim() || DEFAULT_SUMMARY_EMAIL
  const emails = source
    .split(',')
    .map(s => s.trim())
    .filter(s => s.includes('@'))
  return emails.length > 0 ? emails : [DEFAULT_SUMMARY_EMAIL]
}

/** Same E.164 rules as Twilio SMS recipient normalize (kept local to avoid importing twilio in tests). */
export function parseRetellSummarySmsTo(
  raw: string | null | undefined = process.env.RETELL_SUMMARY_SMS_TO,
): string | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  if (SMS_EXTENSION_PATTERN.test(trimmed)) return null
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

export function shouldNotifyRetellAnalyzed(
  existingSummary: string | null | undefined,
  incomingSummary: string | null | undefined,
): boolean {
  const next = incomingSummary?.trim() || null
  if (!next) return false
  const prev = existingSummary?.trim() || null
  return prev !== next
}

function durationLabel(secs: number | null): string {
  if (secs == null || secs < 0) return '—'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function retellCallsAdminUrl(matterId?: string | null, leadId?: string | null): string {
  if (matterId?.trim()) {
    return appUrl(`/admin/matters/${matterId.trim()}?tab=calls`)
  }
  if (leadId?.trim()) {
    return appUrl(`/admin/crm/opportunities/${leadId.trim()}`)
  }
  return appUrl('/admin/calls')
}

export function formatRetellAlertEmail(row: RetellNotifyInput): {
  subject: string
  text: string
  html: string
} {
  const caller = formatPhoneDisplay(row.participant_number) || row.participant_number
  const summary = row.summary?.trim() || '(No summary)'
  const link = retellCallsAdminUrl(row.matter_id, row.lead_id)
  const subject = `Retell call: ${caller}`

  const text = [
    'Retell post-call analysis',
    '',
    `Caller: ${caller}`,
    `Direction: ${row.direction}`,
    `Status: ${row.status}`,
    `Duration: ${durationLabel(row.duration_seconds)}`,
    `From: ${formatPhoneDisplay(row.from_number) || row.from_number}`,
    `To: ${formatPhoneDisplay(row.to_number) || row.to_number}`,
    '',
    'Summary:',
    summary,
    '',
    `View: ${link}`,
  ].join('\n')

  const html = `<div style="font-family:sans-serif;font-size:14px;color:#222;line-height:1.45">
  <h2 style="margin:0 0 12px">Retell post-call analysis</h2>
  <p style="margin:0 0 8px"><strong>Caller:</strong> ${escapeHtml(caller)}</p>
  <p style="margin:0 0 8px"><strong>Direction:</strong> ${escapeHtml(row.direction)} · <strong>Status:</strong> ${escapeHtml(row.status)} · <strong>Duration:</strong> ${escapeHtml(durationLabel(row.duration_seconds))}</p>
  <p style="margin:0 0 12px"><strong>From:</strong> ${escapeHtml(formatPhoneDisplay(row.from_number) || row.from_number)} → <strong>To:</strong> ${escapeHtml(formatPhoneDisplay(row.to_number) || row.to_number)}</p>
  <p style="margin:0 0 4px"><strong>Summary</strong></p>
  <p style="margin:0 0 16px;white-space:pre-wrap">${escapeHtml(summary)}</p>
  <p style="margin:0"><a href="${escapeHtml(link)}" style="color:#1a6b72">Open in Cornerstone →</a></p>
</div>`

  return { subject, text, html }
}

export function formatRetellAlertSms(row: RetellNotifyInput): string {
  const caller = formatPhoneDisplay(row.participant_number) || row.participant_number
  const summary = row.summary?.trim() || '(No summary)'
  const prefix = `Retell ${caller}: `
  const maxSummary = Math.max(40, MAX_SMS_BODY_LENGTH - prefix.length)
  const clipped =
    summary.length > maxSummary ? `${summary.slice(0, Math.max(0, maxSummary - 1))}…` : summary
  return `${prefix}${clipped}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
