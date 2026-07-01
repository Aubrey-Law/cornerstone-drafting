// Deno-side email kill-switch.
//
// Mirrors the logic in lib/email/send.ts so Edge Functions honour the same
// per-category modes, env hard kill, and allowlist as the Next.js routes.
//
// Usage (replace your direct fetch to api.resend.com with this):
//   const result = await sendEmailViaGate(admin, {
//     category: 'message_alert',
//     to: ADMIN_EMAIL,
//     subject: '...',
//     html: '...',
//   })
//   if (!result.ok) return new Response(JSON.stringify({error: result.error}), {status: 502})

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type EmailMode = 'on' | 'off' | 'redirect'
export type EmailCategory =
  | 'lead_notification'
  | 'intake_complete_alert'
  | 'intake_invite'
  | 'engagement_agreement'
  | 'message_alert'
  | 'plan_review_invite'
  | 'plan_review_unlocked'
  | 'post_discovery_followup'
  | 'stage_nudge'
  | 'stage_change_notice'
  | 'portal_message_notice'
  | 'manual'
  | 'outlook_reply'

export interface SendArgs {
  category: EmailCategory
  to: string
  subject: string
  html: string
  text?: string
  from?: string
  replyTo?: string
  cc?: string[]
  /** Variables substituted into a stored Settings template ({{placeholders}}). */
  templateVariables?: EmailTemplateVariables
  /** Defaults to true for automated categories, false for 'manual'. */
  useStoredTemplate?: boolean
}

export type EmailTemplateVariables = Record<string, string | number | null | undefined>

export type SendResult =
  | { ok: true; status: 'sent' | 'redirected'; resendId: string | null }
  | { ok: true; status: 'suppressed'; reason: string }
  | { ok: false; status: 'error'; error: string }

const FROM_DEFAULT = Deno.env.get('RESEND_FROM') ?? 'Scott Aubrey, Esq. <scott@aubreylegal.com>'

function envHardKilled(): boolean {
  return Deno.env.get('EMAILS_ENABLED') === 'false'
}

function getTestInbox(): string {
  return Deno.env.get('EMAIL_TEST_INBOX') || 'scott@aubreylegal.com'
}

function getAllowlist(): string[] {
  const raw = Deno.env.get('EMAIL_ALLOWLIST')
  if (!raw) return []
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

function isAllowed(toAddr: string): boolean {
  const allow = getAllowlist()
  if (allow.length === 0) return true
  const lower = toAddr.toLowerCase()
  return allow.some(entry => entry.includes('@') ? entry === lower : lower.endsWith('@' + entry))
}

async function getModeAndProvider(
  admin: SupabaseClient,
  category: EmailCategory,
): Promise<{ mode: EmailMode; provider: 'resend' | 'graph' }> {
  const { data } = await admin
    .from('email_settings')
    .select('mode, provider')
    .eq('category', category)
    .maybeSingle()
  const row = data as { mode?: EmailMode; provider?: 'resend' | 'graph' } | null
  return {
    mode: row?.mode ?? 'off',
    provider: row?.provider ?? 'resend',
  }
}

function injectBanner(html: string, intendedTo: string): string {
  const banner = `<div style="background:#fde68a;color:#78350f;padding:12px 16px;font-family:sans-serif;font-size:13px;border-bottom:1px solid #f59e0b">
    <strong>TEST SEND.</strong> Original recipient: <code>${intendedTo}</code>.
  </div>`
  if (/<body[^>]*>/i.test(html)) return html.replace(/<body[^>]*>/i, m => `${m}${banner}`)
  return banner + html
}

async function logSend(admin: SupabaseClient, row: Record<string, unknown>): Promise<void> {
  try {
    await admin.from('email_log').insert(row)
  } catch {
    // best-effort
  }
}

// --- Stored Settings templates (mirrors lib/email/templateShared.ts) ---------

const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'p', 'br', 'span', 'div'])
const HTML_TAG_RE = /<\/?(?:b|strong|i|em|u|a|ul|ol|li|p|br|span|div)\b[^>]*>/i

function escapeTplHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderTplText(value: string, vars: EmailTemplateVariables): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (m, k: string) => {
    const r = vars[k]
    return r === null || r === undefined ? m : String(r)
  })
}

function renderTplHtmlValues(value: string, vars: EmailTemplateVariables): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (m, k: string) => {
    const r = vars[k]
    return r === null || r === undefined ? m : escapeTplHtml(String(r))
  })
}

function tplTextToHtml(text: string): string {
  const e = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return e.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`).join('')
}

function sanitizeTplHtml(html: string): string {
  if (!html) return ''
  return html
    .replace(/<(script|style|iframe|object|embed|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?([a-zA-Z][\w-]*)\b[^>]*>/g, (tag, name: string) =>
      ALLOWED_TAGS.has(String(name).toLowerCase()) ? tag : '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/(\s(?:href|src)\s*=\s*)"(?:\s|&nbsp;)*(?:javascript|data|vbscript):[^"]*"/gi, '$1"#"')
    .replace(/(\s(?:href|src)\s*=\s*)'(?:\s|&nbsp;)*(?:javascript|data|vbscript):[^']*'/gi, "$1'#'")
}

function renderTplBodyHtml(body: string, vars: EmailTemplateVariables): string {
  return HTML_TAG_RE.test(body)
    ? sanitizeTplHtml(renderTplHtmlValues(body, vars))
    : tplTextToHtml(renderTplText(body, vars))
}

async function getDefaultTemplate(
  admin: SupabaseClient,
  category: EmailCategory,
): Promise<{ subject: string; body: string } | null> {
  const { data } = await admin
    .from('email_templates')
    .select('subject, body')
    .eq('category', category)
    .eq('is_active', true)
    .eq('is_default', true)
    .maybeSingle()
  const row = data as { subject?: string; body?: string } | null
  if (!row?.body) return null
  return { subject: row.subject ?? '', body: row.body }
}

function isFullEmailDocument(html: string): boolean {
  return /<!DOCTYPE|<html[\s>]/i.test(html)
}

interface BrandInfo { logo: boolean; firmName: string; email: string; city: string }

async function getBrandInfo(admin: SupabaseClient): Promise<BrandInfo> {
  try {
    const { data } = await admin
      .from('firm_settings')
      .select('email_logo_header, firm_name, email, city')
      .eq('id', 1)
      .maybeSingle()
    const row = data as { email_logo_header?: boolean; firm_name?: string; email?: string; city?: string } | null
    return {
      logo: row?.email_logo_header ?? true,
      firmName: row?.firm_name ?? 'Aubrey Law',
      email: row?.email ?? 'scott@aubreylegal.com',
      city: row?.city ?? '',
    }
  } catch {
    return { logo: true, firmName: 'Aubrey Law', email: 'scott@aubreylegal.com', city: '' }
  }
}

function wrapEmailWithBrand(bodyHtml: string, info: BrandInfo): string {
  const cityLine = info.city ? `${info.city}, MA` : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9fafb;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td align="center" style="padding:40px 40px 16px;">
              <p style="margin:0;font-family:Georgia,'Palatino Linotype',Palatino,'Book Antiqua',serif;font-size:30px;font-weight:normal;letter-spacing:2px;line-height:1;">
                <span style="color:#1a3a5c;">AUBREY</span> <span style="color:#2a7d70;">LAW</span>
              </p>
              <p style="margin:10px 0 0;font-family:Georgia,'Palatino Linotype',Palatino,serif;font-size:11px;letter-spacing:1px;color:#9ab0be;">
                Your Legacy. Carefully Planned.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px;">
              <div style="border-top:1px solid #e5e7eb;line-height:1px;font-size:1px;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 40px 32px;font-size:15px;color:#374151;line-height:1.6;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
                ${info.firmName}${cityLine ? ` &middot; ${cityLine}` : ''}<br />
                <a href="mailto:${info.email}" style="color:#2a7d70;text-decoration:none;">${info.email}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export async function sendEmailViaGate(admin: SupabaseClient, args: SendArgs): Promise<SendResult> {
  const { category, to, replyTo, cc } = args
  const from = args.from ?? FROM_DEFAULT
  const ccList = cc && cc.length > 0 ? cc : undefined

  let subject = args.subject
  let html = args.html
  let text = args.text

  // Stored Settings template overrides inline html/text (matches lib/email/send.ts).
  const useStoredTemplate = args.useStoredTemplate ?? category !== 'manual'
  if (useStoredTemplate) {
    const template = await getDefaultTemplate(admin, category)
    if (template) {
      subject = renderTplText(template.subject, args.templateVariables ?? {})
      html = renderTplBodyHtml(template.body, args.templateVariables ?? {})
      text = undefined
      if (!isFullEmailDocument(html)) {
        const brand = await getBrandInfo(admin)
        if (brand.logo) html = wrapEmailWithBrand(html, brand)
      }
    }
  }

  // 1. Env hard kill
  if (envHardKilled()) {
    await logSend(admin, {
      category, to_email: to, intended_to: to, actual_to: null,
      subject, reply_to: replyTo ?? null,
      cc: ccList ? ccList.join(', ') : null,
      html, status: 'suppressed', error: 'env:EMAILS_ENABLED=false',
    })
    return { ok: true, status: 'suppressed', reason: 'env_hard_kill' }
  }

  // 2. Category mode + provider
  const { mode, provider } = await getModeAndProvider(admin, category)

  // Edge functions cannot send via Microsoft Graph — they have no access to
  // the calendar_connections token / refresh flow used by lib/microsoftCalendar.ts.
  // If an admin has flipped a category triggered from an edge function to
  // provider='graph', that is a misconfig: hard-fail with a clear error so
  // it's impossible to miss in the email log.
  if (provider === 'graph') {
    await logSend(admin, {
      category, to_email: to, intended_to: to, actual_to: null,
      subject, reply_to: replyTo ?? null,
      cc: ccList ? ccList.join(', ') : null,
      html,
      provider: 'graph',
      status: 'error',
      error: `edge_cannot_send_via_graph: category '${category}' is triggered by an Edge Function but configured for Microsoft Graph. Switch this category to 'resend' in /admin/settings/email.`,
    })
    return {
      ok: false,
      status: 'error',
      error: `Category '${category}' is configured for Microsoft Graph but is triggered by an Edge Function. Switch it to Resend in admin settings.`,
    }
  }

  const providerUsed: 'resend' | 'graph' = 'resend'

  if (mode === 'off') {
    await logSend(admin, {
      category, to_email: to, intended_to: to, actual_to: null,
      subject, reply_to: replyTo ?? null,
      cc: ccList ? ccList.join(', ') : null,
      html, status: 'suppressed', error: `category:${category} mode=off`,
    })
    return { ok: true, status: 'suppressed', reason: 'category_off' }
  }

  // 3. Allowlist
  if (!isAllowed(to)) {
    await logSend(admin, {
      category, to_email: to, intended_to: to, actual_to: null,
      subject, reply_to: replyTo ?? null,
      cc: ccList ? ccList.join(', ') : null,
      html, status: 'suppressed', error: 'allowlist',
    })
    return { ok: true, status: 'suppressed', reason: 'allowlist' }
  }

  const isRedirect = mode === 'redirect'
  const actualTo = isRedirect ? getTestInbox() : to
  const finalSubject = isRedirect ? `[TEST → ${to}] ${subject}` : subject
  const finalHtml = isRedirect ? injectBanner(html, to) : html

  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) {
    await logSend(admin, {
      category, to_email: to, intended_to: to, actual_to: null,
      subject: finalSubject, reply_to: replyTo ?? null,
      cc: ccList ? ccList.join(', ') : null,
      html: finalHtml, status: 'error', error: 'RESEND_API_KEY not configured',
    })
    return { ok: false, status: 'error', error: 'RESEND_API_KEY not configured' }
  }

  const resendBody: Record<string, unknown> = {
    from,
    to: [actualTo],
    subject: finalSubject,
    html: finalHtml,
  }
  if (text) resendBody.text = text
  if (!isRedirect && ccList) resendBody.cc = ccList
  if (replyTo) resendBody.reply_to = replyTo

  let resendId: string | null = null
  let sendError: string | null = null
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(resendBody),
    })
    if (!res.ok) {
      sendError = await res.text()
    } else {
      const data = await res.json().catch(() => ({})) as { id?: string }
      resendId = data.id ?? null
    }
  } catch (err) {
    sendError = err instanceof Error ? err.message : 'Unknown send error'
  }

  await logSend(admin, {
    category,
    to_email: actualTo,
    intended_to: to,
    actual_to: actualTo,
    subject: finalSubject,
    reply_to: replyTo ?? null,
    cc: ccList ? ccList.join(', ') : null,
    html: finalHtml,
    resend_id: resendId,
    provider: providerUsed,
    status: sendError ? 'error' : isRedirect ? 'redirected' : 'sent',
    error: sendError,
  })

  if (sendError) return { ok: false, status: 'error', error: sendError }
  if (isRedirect) return { ok: true, status: 'redirected', resendId }
  return { ok: true, status: 'sent', resendId }
}
