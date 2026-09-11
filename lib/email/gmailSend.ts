import {
  getAccessToken,
  getGoogleConnectionForUser,
  hasGmailSendScope,
} from '@/lib/googleCalendar'
import type { EmailAttachment } from './attachments'

/**
 * Send matter email through the firm's connected Google account.
 *
 * Gmail takes a whole RFC 5322 message rather than a JSON envelope, so this
 * module builds the MIME itself. That is the only real difference from the
 * Resend path: same arguments in, same `{fromAddress, messageId}` out, so
 * `lib/email/send.ts` can pick a provider per category without either side
 * leaking into the caller.
 */

const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const GMAIL_TIMEOUT_MS = 20_000

export type GmailSendErrorKind = 'no_connection' | 'missing_scope' | 'gmail_error'

export class GmailSendError extends Error {
  readonly kind: GmailSendErrorKind
  constructor(kind: GmailSendErrorKind, message: string) {
    super(message)
    this.kind = kind
    this.name = 'GmailSendError'
  }
}

export interface GmailSendArgs {
  to: string
  cc?: string[]
  bcc?: string[]
  subject: string
  html?: string
  text?: string
  replyTo?: string
  /** Mailbox owner for manual sends; falls back to the firm's connection. */
  userId?: string | null
  attachments?: EmailAttachment[]
  /**
   * Threading, for a reply. `<id@host>` tokens — see `replyHeaders.ts`.
   * Omitted by every existing caller, which start new conversations.
   */
  inReplyTo?: string
  references?: string[]
}

export interface GmailSendResult {
  fromAddress: string | null
  messageId: string | null
}

function base64url(value: Buffer | string): string {
  const buf = typeof value === 'string' ? Buffer.from(value, 'utf-8') : value
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Headers are ASCII-only on the wire. A subject with an em dash or an accented
 * client name is legal to write and illegal to send raw, so anything outside
 * ASCII goes out as an RFC 2047 encoded word rather than as mojibake.
 */
function encodeHeaderValue(value: string): string {
  const collapsed = value.replace(/[\r\n]+/g, ' ').trim()
  if (!/[^\u0000-\u007F]/.test(collapsed)) return collapsed
  return `=?UTF-8?B?${Buffer.from(collapsed, 'utf-8').toString('base64')}?=`
}

/**
 * Sanitise a `<id@host>` header token.
 *
 * Deliberately **not** `encodeHeaderValue`. A Message-ID is ASCII by definition
 * and has to appear literally for a client to match it; RFC 2047 encoding one
 * because it happened to contain a non-ASCII byte would produce a header that
 * looks fine and threads nothing. So anything outside printable ASCII is
 * dropped rather than encoded, along with CR and LF — these values arrive in
 * headers written by whoever sent the message, which makes them the one
 * header-injection vector in this module.
 *
 * A token that does not survive as `<…>` is discarded: no header beats a
 * malformed one.
 */
function headerToken(value: string): string | null {
  const cleaned = value.replace(/[^\x21-\x7E]/g, '')
  return /^<[^<>\s]+>$/.test(cleaned) ? cleaned : null
}

/** Base64 body parts are wrapped at 76 characters, as MIME requires. */
function wrapBase64(value: string): string {
  return (value.match(/.{1,76}/g) ?? []).join('\r\n')
}

function header(name: string, value: string): string {
  return `${name}: ${value}`
}

function bodyPart(boundary: string, contentType: string, content: string): string[] {
  return [
    `--${boundary}`,
    header('Content-Type', `${contentType}; charset="UTF-8"`),
    header('Content-Transfer-Encoding', 'base64'),
    '',
    wrapBase64(Buffer.from(content, 'utf-8').toString('base64')),
    '',
  ]
}

function attachmentPart(boundary: string, file: EmailAttachment): string[] {
  return [
    `--${boundary}`,
    header('Content-Type', `${file.contentType ?? 'application/octet-stream'}; name="${file.filename.replace(/"/g, '')}"`),
    header('Content-Transfer-Encoding', 'base64'),
    header('Content-Disposition', `attachment; filename="${file.filename.replace(/"/g, '')}"`),
    '',
    wrapBase64(file.content.toString('base64')),
    '',
  ]
}

/**
 * Build the raw message.
 *
 * `text` and `html` are alternatives of the same message, not two messages, so
 * when both are present they go in a `multipart/alternative` with the plain
 * part first — the order is what tells a client which one to prefer. Files, when
 * there are any, wrap that in a `multipart/mixed`.
 */
export function buildMimeMessage(args: GmailSendArgs & { from?: string | null }): string {
  const headers: string[] = [
    header('MIME-Version', '1.0'),
    header('To', encodeHeaderValue(args.to)),
    header('Subject', encodeHeaderValue(args.subject)),
  ]
  if (args.from) headers.push(header('From', encodeHeaderValue(args.from)))
  if (args.cc?.length) headers.push(header('Cc', encodeHeaderValue(args.cc.join(', '))))
  if (args.bcc?.length) headers.push(header('Bcc', encodeHeaderValue(args.bcc.join(', '))))
  if (args.replyTo) headers.push(header('Reply-To', encodeHeaderValue(args.replyTo)))

  const inReplyTo = args.inReplyTo ? headerToken(args.inReplyTo) : null
  if (inReplyTo) headers.push(header('In-Reply-To', inReplyTo))
  const references = (args.references ?? [])
    .map(headerToken)
    .filter((token): token is string => token !== null)
  if (references.length) headers.push(header('References', references.join(' ')))

  const attachments = args.attachments ?? []
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const altBoundary = `alt-${stamp}`
  const mixedBoundary = `mixed-${stamp}`

  const bodyLines: string[] = []
  if (args.html !== undefined && args.text !== undefined) {
    bodyLines.push(...bodyPart(altBoundary, 'text/plain', args.text))
    bodyLines.push(...bodyPart(altBoundary, 'text/html', args.html))
    bodyLines.push(`--${altBoundary}--`)
  }

  const single = args.html !== undefined
    ? { contentType: 'text/html', content: args.html }
    : { contentType: 'text/plain', content: args.text ?? '' }
  const isMultipartBody = bodyLines.length > 0

  if (attachments.length === 0) {
    if (isMultipartBody) {
      headers.push(header('Content-Type', `multipart/alternative; boundary="${altBoundary}"`))
      return [...headers, '', ...bodyLines].join('\r\n')
    }
    headers.push(header('Content-Type', `${single.contentType}; charset="UTF-8"`))
    headers.push(header('Content-Transfer-Encoding', 'base64'))
    return [
      ...headers,
      '',
      wrapBase64(Buffer.from(single.content, 'utf-8').toString('base64')),
    ].join('\r\n')
  }

  headers.push(header('Content-Type', `multipart/mixed; boundary="${mixedBoundary}"`))
  const lines: string[] = [...headers, '']
  if (isMultipartBody) {
    lines.push(
      `--${mixedBoundary}`,
      header('Content-Type', `multipart/alternative; boundary="${altBoundary}"`),
      '',
      ...bodyLines,
    )
  } else {
    lines.push(...bodyPart(mixedBoundary, single.contentType, single.content))
  }
  for (const file of attachments) lines.push(...attachmentPart(mixedBoundary, file))
  lines.push(`--${mixedBoundary}--`, '')
  return lines.join('\r\n')
}

/** Send via the Gmail API using the firm's connected Google account. */
export async function sendViaGmail(args: GmailSendArgs): Promise<GmailSendResult> {
  const conn = await getGoogleConnectionForUser(args.userId)
  if (!conn) {
    throw new GmailSendError('no_connection', 'Google account is not connected')
  }
  if (!hasGmailSendScope(conn.scopes)) {
    throw new GmailSendError(
      'missing_scope',
      'Google connection is missing the Gmail send scope — reconnect from Settings',
    )
  }

  let token: string
  try {
    token = await getAccessToken(args.userId ?? conn.user_id)
  } catch (err) {
    throw new GmailSendError(
      'no_connection',
      err instanceof Error ? err.message : 'Failed to acquire a Google access token',
    )
  }

  // Gmail always sends as the authenticated account, so `From` is set to the
  // connected address rather than the firm's Resend sender: naming a domain the
  // account cannot send for is how a message lands in spam or is rejected.
  const raw = buildMimeMessage({ ...args, from: conn.email })

  let r: Response
  try {
    r = await fetch(GMAIL_SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: base64url(raw) }),
      signal: AbortSignal.timeout(GMAIL_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new GmailSendError('gmail_error', 'Gmail request timed out')
    }
    throw new GmailSendError('gmail_error', err instanceof Error ? err.message : 'Gmail send failed')
  }

  const json = (await r.json().catch(() => ({}))) as {
    id?: string
    error?: { message?: string; status?: string }
  }
  if (!r.ok) {
    const detail = json.error?.message
      ? `${json.error.status ?? r.status}: ${json.error.message}`
      : `${r.status} ${r.statusText}`
    throw new GmailSendError('gmail_error', detail)
  }

  return { fromAddress: conn.email, messageId: json.id ?? null }
}
