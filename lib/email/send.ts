import { Resend } from 'resend'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getResendFromAsync, loadFirmSettings } from '@/lib/firmSettings'
import { isFullEmailDocument, wrapEmailWithBrand } from './brandWrapper'
import type { EmailCategory, EmailProvider } from './categories'
import { applyEmailTemplate, getDefaultEmailTemplate } from './templates'
import type { EmailTemplateVariables } from './templateShared'
import {
  envEmailsHardKilled,
  getAllSettings,
  getTestInbox,
  isAllowed,
} from './settings'
import { GmailSendError, sendViaGmail } from './gmailSend'
import type { EmailAttachment } from './attachments'
import { assembleManualEmail } from './manualAssembly'
import { redactIdentifier } from '@/lib/log/redact'

export interface SendEmailArgs {
  category: EmailCategory
  to: string
  subject: string
  html?: string
  text?: string
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string
  templateVariables?: EmailTemplateVariables
  /** Defaults to true for automated categories and false for manual one-off sends. */
  useStoredTemplate?: boolean
  from?: string
  /** Gmail mailbox owner for manual sends; falls back to any firm connection. */
  userId?: string | null
  /** Files to send alongside the message. See lib/email/attachments.ts for the size cap. */
  attachments?: EmailAttachment[]
  /** Append the current firm signature. Honored only for manual sends. */
  includeSignature?: boolean
  /**
   * The record this email belongs to, so it lands in that timeline. At most
   * one should be set; a contact wins the thread key when combined.
   */
  matterId?: string | null
  leadId?: string | null
  contactId?: string | null
}

export type SendEmailResult =
  | { ok: true; status: 'sent'; providerMessageId: string | null; logId: string | null }
  | { ok: true; status: 'redirected'; providerMessageId: string | null; logId: string | null; actualTo: string }
  | { ok: true; status: 'suppressed'; logId: string | null; reason: 'env_hard_kill' | 'category_off' | 'allowlist' }
  | { ok: true; status: 'logged'; reason: 'no_api_key'; logId: string | null }
  | { ok: false; status: 'error'; error: string; logId: string | null }

function addressArray(value: string | string[] | undefined): string[] | undefined {
  if (!value) return undefined
  const list = Array.isArray(value)
    ? value
    : value.split(',').map(s => s.trim()).filter(Boolean)
  return list.length > 0 ? list : undefined
}

function injectTestBanner(html: string, intendedTo: string): string {
  const banner = `<div style="background:#fde68a;color:#78350f;padding:12px 16px;font-family:sans-serif;font-size:13px;border-bottom:1px solid #f59e0b">
    <strong>TEST SEND.</strong> Original recipient: <code>${intendedTo}</code>. This email was redirected to the test inbox by the email kill-switch.
  </div>`
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, m => `${m}${banner}`)
  }
  return banner + html
}

function injectTestNoticeText(text: string, intendedTo: string): string {
  return `TEST SEND. Original recipient: ${intendedTo}. This email was redirected to the test inbox by the email kill-switch.\n\n${text}`
}

/**
 * Record a send in `email_log`, so it appears on the record's timeline. Exported
 * for the one caller that sends through Gmail directly rather than through
 * `sendEmail` — a triage reply, which has to land on an existing thread.
 */
export async function logSend(row: Record<string, unknown>): Promise<string | null> {
  const insertRow = (payload: Record<string, unknown>) =>
    getAdminClient()
      .from('email_log')
      .insert({ sent_at: new Date().toISOString(), ...payload })
      .select('id')
      .single()

  try {
    const { data, error } = await insertRow(row)
    if (!error) return (data?.id as string | undefined) ?? null
    // bcc arrives in 20260729014420 and lead_id/contact_id in 20260830000000.
    // On a database that hasn't run them, log the send without those columns
    // rather than losing the row.
    const optional = ['bcc', 'lead_id', 'contact_id'].filter(key => key in row)
    if (optional.length > 0) {
      const retry = await insertRow(
        Object.fromEntries(Object.entries(row).filter(([key]) => !optional.includes(key))),
      )
      return (retry.data?.id as string | undefined) ?? null
    }
    return null
  } catch {
    return null
  }
}

interface ResendAttemptInput {
  from: string
  to: string
  subject: string
  html?: string
  text?: string
  ccList: string[] | undefined
  bccList: string[] | undefined
  replyTo: string | undefined
  isRedirect: boolean
  attachments?: EmailAttachment[]
}

interface AttemptResult {
  /** The sending provider's own message id, when it returns one. */
  providerMessageId: string | null
  fromAddress: string | null
  error: string | null
}

async function attemptResend(input: ResendAttemptInput): Promise<AttemptResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return { providerMessageId: null, fromAddress: input.from, error: 'RESEND_API_KEY not configured' }
  }
  const resend = new Resend(apiKey)
  try {
    const { data, error } = await resend.emails.send({
      from: input.from,
      to: input.to,
      subject: input.subject,
      ...(input.html !== undefined ? { html: input.html } : { text: input.text ?? '' }),
      ...(input.isRedirect ? {} : input.ccList && input.ccList.length > 0 ? { cc: input.ccList } : {}),
      ...(input.isRedirect ? {} : input.bccList && input.bccList.length > 0 ? { bcc: input.bccList } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      ...(input.attachments?.length
        ? {
            attachments: input.attachments.map(file => ({
              filename: file.filename,
              content: file.content,
              ...(file.contentType ? { contentType: file.contentType } : {}),
            })),
          }
        : {}),
    })
    if (error) {
      return { providerMessageId: null, fromAddress: input.from, error: error.message }
    }
    return { providerMessageId: data?.id ?? null, fromAddress: input.from, error: null }
  } catch (err) {
    return {
      providerMessageId: null,
      fromAddress: input.from,
      error: err instanceof Error ? err.message : 'Unknown send error',
    }
  }
}

async function attemptGmail(
  input: ResendAttemptInput,
  userId?: string | null,
): Promise<AttemptResult> {
  try {
    const { fromAddress, messageId } = await sendViaGmail({
      to: input.to,
      cc: input.isRedirect ? undefined : input.ccList,
      bcc: input.isRedirect ? undefined : input.bccList,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
      userId,
      attachments: input.attachments,
    })
    return { providerMessageId: messageId, fromAddress, error: null }
  } catch (err) {
    const msg = err instanceof GmailSendError
      ? `${err.kind}: ${err.message}`
      : err instanceof Error ? err.message : 'Unknown Gmail error'
    return { providerMessageId: null, fromAddress: null, error: msg }
  }
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const { category, to, cc, bcc, replyTo, userId } = args
  // Spread into every email_log row so a send is findable in its timeline
  // whichever branch below records it (suppressed, logged, sent or error).
  const recordLink = {
    matter_id: args.matterId ?? null,
    lead_id: args.leadId ?? null,
    contact_id: args.contactId ?? null,
  }
  let subject = args.subject
  let html = args.html
  let text = args.text

  const useStoredTemplate = args.useStoredTemplate ?? category !== 'manual'
  if (useStoredTemplate) {
    const template = await getDefaultEmailTemplate(category)
    if (template) {
      const rendered = applyEmailTemplate(template, args.templateVariables)
      subject = rendered.subject
      text = rendered.text
      html = rendered.html

      if (html && !isFullEmailDocument(html)) {
        const firm = await loadFirmSettings()
        if (firm.emailLogoHeader) {
          html = wrapEmailWithBrand(html, {
            firmName: firm.firmName,
            email: firm.email,
            city: firm.city,
          })
        }
      }
    }
  }
  if (category === 'manual' && !useStoredTemplate) {
    const assembled = await assembleManualEmail({
      html,
      text,
      includeSignature: args.includeSignature,
    })
    html = assembled.html
    text = assembled.text
  }

  const body = text ?? html
  if (!body) {
    return { ok: false, status: 'error', error: 'Email body is required', logId: null }
  }

  const resendFrom = args.from ?? await getResendFromAsync()
  const ccList = addressArray(cc)
  const bccList = addressArray(bcc)

  if (envEmailsHardKilled()) {
    const logId = await logSend({
      ...recordLink,
      category,
      to_email: to,
      intended_to: to,
      actual_to: null,
      subject,
      reply_to: replyTo ?? null,
      cc: ccList ? ccList.join(', ') : null,
      bcc: bccList ? bccList.join(', ') : null,
      html: body,
      status: 'suppressed',
      error: 'env:EMAILS_ENABLED=false',
    })
    return { ok: true, status: 'suppressed', logId, reason: 'env_hard_kill' }
  }

  const settings = await getAllSettings()
  const { mode, provider } = settings[category]
  if (mode === 'off') {
    const logId = await logSend({
      ...recordLink,
      category,
      to_email: to,
      intended_to: to,
      actual_to: null,
      subject,
      reply_to: replyTo ?? null,
      cc: ccList ? ccList.join(', ') : null,
      bcc: bccList ? bccList.join(', ') : null,
      html: body,
      status: 'suppressed',
      error: `category:${category} mode=off`,
    })
    return { ok: true, status: 'suppressed', logId, reason: 'category_off' }
  }

  if (!isAllowed(to)) {
    const logId = await logSend({
      ...recordLink,
      category,
      to_email: to,
      intended_to: to,
      actual_to: null,
      subject,
      reply_to: replyTo ?? null,
      cc: ccList ? ccList.join(', ') : null,
      bcc: bccList ? bccList.join(', ') : null,
      html: body,
      status: 'suppressed',
      error: 'allowlist',
    })
    return { ok: true, status: 'suppressed', logId, reason: 'allowlist' }
  }

  const isRedirect = mode === 'redirect'
  const actualTo = isRedirect ? getTestInbox() : to
  const finalSubject = isRedirect ? `[TEST → ${to}] ${subject}` : subject
  const finalHtml = html !== undefined
    ? isRedirect ? injectTestBanner(html, to) : html
    : undefined
  const finalText = text !== undefined
    ? isRedirect ? injectTestNoticeText(text, to) : text
    : undefined
  const finalBody = finalText ?? finalHtml ?? body

  const attemptInput: ResendAttemptInput = {
    from: resendFrom,
    to: actualTo,
    subject: finalSubject,
    html: finalHtml,
    text: finalText,
    ccList,
    bccList,
    replyTo,
    isRedirect,
    attachments: args.attachments,
  }

  let providerUsed: EmailProvider = provider
  let result: AttemptResult

  if (provider === 'gmail') {
    const gmailResult = await attemptGmail(attemptInput, userId)
    if (!gmailResult.error) {
      result = gmailResult
    } else {
      await logSend({
        ...recordLink,
        category,
        to_email: actualTo,
        intended_to: to,
        actual_to: actualTo,
        subject: finalSubject,
        reply_to: replyTo ?? null,
        cc: ccList ? ccList.join(', ') : null,
        bcc: bccList ? bccList.join(', ') : null,
        html: finalBody,
        provider: 'gmail',
        status: 'error',
        error: `gmail_failed_falling_back: ${gmailResult.error}`,
      })
      providerUsed = 'resend'
      result = await attemptResend(attemptInput)
    }
  } else {
    result = await attemptResend(attemptInput)
  }

  if (providerUsed === 'resend' && result.error === 'RESEND_API_KEY not configured') {
    // Recipient and subject are client data; the send is already recorded in
    // full in email_log, which lives inside the confidentiality boundary.
    console.info(`[email] no RESEND_API_KEY — would send (${category}):`, {
      to: redactIdentifier(actualTo),
      from: resendFrom,
      replyTo: redactIdentifier(replyTo),
    })
    const logId = await logSend({
      ...recordLink,
      category,
      to_email: actualTo,
      intended_to: to,
      actual_to: actualTo,
      subject: finalSubject,
      reply_to: replyTo ?? null,
      cc: ccList ? ccList.join(', ') : null,
      bcc: bccList ? bccList.join(', ') : null,
      html: finalBody,
      status: 'logged',
      error: 'no_api_key',
    })
    return { ok: true, status: 'logged', reason: 'no_api_key', logId }
  }

  const logId = await logSend({
    ...recordLink,
    category,
    to_email: actualTo,
    intended_to: to,
    actual_to: actualTo,
    subject: finalSubject,
    reply_to: replyTo ?? null,
    cc: ccList ? ccList.join(', ') : null,
    bcc: bccList ? bccList.join(', ') : null,
    html: finalBody,
    provider: providerUsed,
    provider_message_id: result.providerMessageId,
    status: result.error ? 'error' : isRedirect ? 'redirected' : 'sent',
    error: result.error,
  })

  if (result.error) return { ok: false, status: 'error', error: result.error, logId }
  if (isRedirect) {
    return { ok: true, status: 'redirected', providerMessageId: result.providerMessageId, logId, actualTo }
  }
  return { ok: true, status: 'sent', providerMessageId: result.providerMessageId, logId }
}
