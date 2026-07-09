import { Resend } from 'resend'
import { getFirmConfig } from '@/lib/firmConfig'
import type { EmailCategory } from './categories'

export interface SendEmailArgs {
  to: string
  subject: string
  html: string
  category: EmailCategory
  from?: string
  replyTo?: string
}

export type SendEmailResult =
  | { ok: true; status: 'sent'; resendId: string | null }
  | { ok: true; status: 'suppressed'; reason: 'env_hard_kill' }
  | { ok: true; status: 'logged'; reason: 'no_api_key' }
  | { ok: false; status: 'error'; error: string }

function envEmailsHardKilled(): boolean {
  const raw = process.env.EMAILS_ENABLED
  if (raw === undefined || raw === '') return false
  return raw === 'false' || raw === '0' || raw.toLowerCase() === 'off'
}

/**
 * Minimal Resend send helper for Cornerstone lite.
 * Honours EMAILS_ENABLED=false kill switch. Logs to console when RESEND_API_KEY is unset.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const { to, subject, html, category, from, replyTo } = args

  if (envEmailsHardKilled()) {
    console.info(`[email] suppressed (${category}): EMAILS_ENABLED=false → ${to} · ${subject}`)
    return { ok: true, status: 'suppressed', reason: 'env_hard_kill' }
  }

  const firm = getFirmConfig()
  const fromAddress = from ?? `${firm.attorneyShortName} <${firm.email}>`
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    console.info(`[email] no RESEND_API_KEY — would send (${category}):`, {
      to,
      subject,
      from: fromAddress,
      replyTo,
    })
    return { ok: true, status: 'logged', reason: 'no_api_key' }
  }

  const resend = new Resend(apiKey)
  const { data, error } = await resend.emails.send({
    from: fromAddress,
    to,
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  })

  if (error) {
    console.error(`[email] send failed (${category}):`, error.message)
    return { ok: false, status: 'error', error: error.message }
  }

  return { ok: true, status: 'sent', resendId: data?.id ?? null }
}
