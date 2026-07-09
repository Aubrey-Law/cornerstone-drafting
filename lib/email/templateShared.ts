import type { EmailCategory } from './categories'

export interface EmailTemplateOption {
  id: string
  name: string
  category: EmailCategory
  subject: string
  body: string
  isActive: boolean
  isDefault: boolean
  updatedAt: string | null
}

export type EmailTemplateVariables = Record<string, string | number | null | undefined>

export function renderEmailTemplateText(
  value: string,
  variables: EmailTemplateVariables = {},
): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key: string) => {
    const replacement = variables[key]
    if (replacement === null || replacement === undefined) return match
    return String(replacement)
  })
}

export function textToEmailHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return escaped
    .split(/\n{2,}/)
    .map(paragraph => `<p>${paragraph.replace(/\n/g, '<br/>')}</p>`)
    .join('')
}

// Tags kept in stored/rendered email-template HTML — mirrors the allowlist the
// RichTextEmailEditor enforces on the client so the editor and the send
// pipeline agree on the format.
const ALLOWED_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'p', 'br', 'span', 'div',
])

/**
 * Server-safe sanitizer for email-template HTML. Dependency-free on purpose:
 * the rich-text editor already DOMPurifies on the client before any HTML is
 * sent, and these write paths are admin-only, so this is defense-in-depth.
 * We deliberately avoid isomorphic-dompurify/jsdom here — this module is loaded
 * by the email API routes and the outbound-email pipeline, and jsdom fails to
 * trace into Vercel's serverless lambdas (crashing the function at load).
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return ''
  return html
    // Drop dangerous elements together with their content.
    .replace(/<(script|style|iframe|object|embed|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
    // Strip any remaining tag not on the allowlist (keeping its inner text).
    .replace(/<\/?([a-zA-Z][\w-]*)\b[^>]*>/g, (tag, name: string) =>
      ALLOWED_TAGS.has(String(name).toLowerCase()) ? tag : '')
    // Remove inline event handlers (onclick=, onerror=, …).
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    // Neutralize dangerous URL schemes in href/src.
    .replace(/(\s(?:href|src)\s*=\s*)"(?:\s|&nbsp;)*(?:javascript|data|vbscript):[^"]*"/gi, '$1"#"')
    .replace(/(\s(?:href|src)\s*=\s*)'(?:\s|&nbsp;)*(?:javascript|data|vbscript):[^']*'/gi, "$1'#'")
}

// A template body authored in the rich-text editor is stored as HTML; legacy
// bodies are plain text. We detect the format by looking for any of the
// allowlisted tags so both render correctly with no data migration. A stray
// "<" (e.g. "fee < $500") in plain text won't match a real tag pattern.
const HTML_TAG_RE = /<\/?(?:b|strong|i|em|u|a|ul|ol|li|p|br|span|div)\b[^>]*>/i

export function isHtmlTemplateBody(body: string): boolean {
  return HTML_TAG_RE.test(body)
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Substitute {{placeholders}} inside an HTML body, HTML-escaping the injected
// values so a name/value containing "&" or "<" can't break or inject markup.
function renderHtmlTemplateValues(value: string, variables: EmailTemplateVariables): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key: string) => {
    const replacement = variables[key]
    if (replacement === null || replacement === undefined) return match
    return escapeHtml(String(replacement))
  })
}

/** Plain-text projection of email-template HTML (for the text/alt part and previews). */
export function emailTemplateHtmlToText(html: string): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Render a template body to send-ready HTML, format-aware: HTML bodies are
 * substituted (values escaped) and sanitized; legacy plain-text bodies are
 * substituted then converted via textToEmailHtml. Avoids double-escaping HTML.
 */
export function renderEmailTemplateBodyHtml(
  body: string,
  variables: EmailTemplateVariables = {},
): string {
  if (isHtmlTemplateBody(body)) {
    return sanitizeEmailHtml(renderHtmlTemplateValues(body, variables))
  }
  return textToEmailHtml(renderEmailTemplateText(body, variables))
}

/** Render a template body to the plain-text part, format-aware. */
export function renderEmailTemplateBodyText(
  body: string,
  variables: EmailTemplateVariables = {},
): string {
  const substituted = renderEmailTemplateText(body, variables)
  return isHtmlTemplateBody(body) ? emailTemplateHtmlToText(substituted) : substituted
}
