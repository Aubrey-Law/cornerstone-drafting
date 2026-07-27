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
import { GraphSendError, sendViaGraph } from './graphSend'

export interface SendEmailArgs {
  category: EmailCategory
  to: string
  subject: string
  html?: string
  text?: string
  cc?: string | string[]
  replyTo?: string
  templateVariables?: EmailTemplateVariables
  /** Defaults to true for automated categories and false for manual one-off sends. */
  useStoredTemplate?: boolean
  from?: string
  /** Microsoft Graph mailbox owner for manual sends; falls back to any firm connection. */
  userId?: string | null
}

export type SendEmailResult =
  | { ok: true; status: 'sent'; resendId: string | null; logId: string | null }
  | { ok: true; status: 'redirected'; resendId: string | null; logId: string | null; actualTo: string }
  | { ok: true; status: 'suppressed'; logId: string | null; reason: 'env_hard_kill' | 'category_off' | 'allowlist' }
  | { ok: true; status: 'logged'; reason: 'no_api_key'; logId: string | null }
  | { ok: false; status: 'error'; error: string; logId: string | null }

function ccArray(cc: string | string[] | undefined): string[] | undefined {
  if (!cc) return undefined
  const list = Array.isArray(cc)
    ? cc
    : cc.split(',').map(s => s.trim()).filter(Boolean)
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

async function logSend(row: Record<string, unknown>): Promise<string | null> {
  try {
    const { data } = await getAdminClient()
      .from('email_log')
      .insert({ sent_at: new Date().toISOString(), ...row })
      .select('id')
      .single()
    return (data?.id as string | undefined) ?? null
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
  replyTo: string | undefined
  isRedirect: boolean
}

interface AttemptResult {
  resendId: string | null
  graphMessageId: string | null
  fromAddress: string | null
  error: string | null
}

async function attemptResend(input: ResendAttemptInput): Promise<AttemptResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return { resendId: null, graphMessageId: null, fromAddress: input.from, error: 'RESEND_API_KEY not configured' }
  }
  const resend = new Resend(apiKey)
  try {
    const { data, error } = await resend.emails.send({
      from: input.from,
      to: input.to,
      subject: input.subject,
      ...(input.html !== undefined ? { html: input.html } : { text: input.text ?? '' }),
      ...(input.isRedirect ? {} : input.ccList && input.ccList.length > 0 ? { cc: input.ccList } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    })
    if (error) {
      return { resendId: null, graphMessageId: null, fromAddress: input.from, error: error.message }
    }
    return { resendId: data?.id ?? null, graphMessageId: null, fromAddress: input.from, error: null }
  } catch (err) {
    return {
      resendId: null,
      graphMessageId: null,
      fromAddress: input.from,
      error: err instanceof Error ? err.message : 'Unknown send error',
    }
  }
}

async function attemptGraph(
  input: ResendAttemptInput,
  userId?: string | null,
): Promise<AttemptResult> {
  try {
    const { fromAddress, messageId } = await sendViaGraph({
      to: input.to,
      cc: input.isRedirect ? undefined : input.ccList,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
      userId,
    })
    return { resendId: null, graphMessageId: messageId, fromAddress, error: null }
  } catch (err) {
    const msg = err instanceof GraphSendError
      ? `${err.kind}: ${err.message}`
      : err instanceof Error ? err.message : 'Unknown Graph error'
    return { resendId: null, graphMessageId: null, fromAddress: null, error: msg }
  }
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const { category, to, cc, replyTo, userId } = args
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

  const body = text ?? html
  if (!body) {
    return { ok: false, status: 'error', error: 'Email body is required', logId: null }
  }

  const resendFrom = args.from ?? await getResendFromAsync()
  const ccList = ccArray(cc)

  if (envEmailsHardKilled()) {
    const logId = await logSend({
      category,
      to_email: to,
      intended_to: to,
      actual_to: null,
      subject,
      reply_to: replyTo ?? null,
      cc: ccList ? ccList.join(', ') : null,
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
      category,
      to_email: to,
      intended_to: to,
      actual_to: null,
      subject,
      reply_to: replyTo ?? null,
      cc: ccList ? ccList.join(', ') : null,
      html: body,
      status: 'suppressed',
      error: `category:${category} mode=off`,
    })
    return { ok: true, status: 'suppressed', logId, reason: 'category_off' }
  }

  if (!isAllowed(to)) {
    const logId = await logSend({
      category,
      to_email: to,
      intended_to: to,
      actual_to: null,
      subject,
      reply_to: replyTo ?? null,
      cc: ccList ? ccList.join(', ') : null,
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
    replyTo,
    isRedirect,
  }

  let providerUsed: EmailProvider = provider
  let result: AttemptResult

  if (provider === 'graph') {
    const graphResult = await attemptGraph(attemptInput, userId)
    if (!graphResult.error) {
      result = graphResult
    } else {
      await logSend({
        category,
        to_email: actualTo,
        intended_to: to,
        actual_to: actualTo,
        subject: finalSubject,
        reply_to: replyTo ?? null,
        cc: ccList ? ccList.join(', ') : null,
        html: finalBody,
        provider: 'graph',
        status: 'error',
        error: `graph_failed_falling_back: ${graphResult.error}`,
      })
      providerUsed = 'resend'
      result = await attemptResend(attemptInput)
    }
  } else {
    result = await attemptResend(attemptInput)
  }

  if (providerUsed === 'resend' && result.error === 'RESEND_API_KEY not configured') {
    console.info(`[email] no RESEND_API_KEY — would send (${category}):`, {
      to: actualTo,
      subject: finalSubject,
      from: resendFrom,
      replyTo,
    })
    const logId = await logSend({
      category,
      to_email: actualTo,
      intended_to: to,
      actual_to: actualTo,
      subject: finalSubject,
      reply_to: replyTo ?? null,
      cc: ccList ? ccList.join(', ') : null,
      html: finalBody,
      status: 'logged',
      error: 'no_api_key',
    })
    return { ok: true, status: 'logged', reason: 'no_api_key', logId }
  }

  const logId = await logSend({
    category,
    to_email: actualTo,
    intended_to: to,
    actual_to: actualTo,
    subject: finalSubject,
    reply_to: replyTo ?? null,
    cc: ccList ? ccList.join(', ') : null,
    html: finalBody,
    resend_id: result.resendId,
    provider: providerUsed,
    provider_message_id: result.graphMessageId,
    status: result.error ? 'error' : isRedirect ? 'redirected' : 'sent',
    error: result.error,
  })

  if (result.error) return { ok: false, status: 'error', error: result.error, logId }
  if (isRedirect) {
    return { ok: true, status: 'redirected', resendId: result.resendId, logId, actualTo }
  }
  return { ok: true, status: 'sent', resendId: result.resendId, logId }
}
