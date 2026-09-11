import { getAccessToken, getGoogleConnectionForUser, hasGmailModifyScope } from '@/lib/googleCalendar'
import { GmailSendError, buildMimeMessage } from './gmailSend'

/**
 * Create a reply draft in the firm's Gmail, on the thread being answered.
 *
 * A draft rather than a send, and that is the product decision rather than an
 * implementation detail: the model drafts, the attorney sends. Cornerstone
 * never puts a generated reply in front of a client on its own, and the code
 * that could is deliberately not here.
 *
 * Separate from `gmailSend.ts` so that module stays about sending, but it
 * shares the MIME builder — a draft and a send are the same message, and two
 * builders would drift.
 */

const GMAIL_DRAFTS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts'
const GMAIL_TIMEOUT_MS = 20_000

function base64url(value: string): string {
  return Buffer.from(value, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export interface GmailDraftArgs {
  to: string
  cc?: string[]
  subject: string
  text?: string
  html?: string
  /** The Gmail thread to attach the draft to. */
  threadId: string
  inReplyTo?: string
  references?: string[]
  userId?: string | null
}

export interface GmailDraftResult {
  draftId: string
  messageId: string | null
  threadId: string | null
  fromAddress: string | null
}

async function gmailFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(GMAIL_TIMEOUT_MS) })
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new GmailSendError('gmail_error', 'Gmail request timed out')
    }
    throw new GmailSendError('gmail_error', err instanceof Error ? err.message : 'Gmail request failed')
  }
}

async function connect(userId?: string | null) {
  const conn = await getGoogleConnectionForUser(userId)
  if (!conn) throw new GmailSendError('no_connection', 'Google account is not connected')
  if (!hasGmailModifyScope(conn.scopes)) {
    throw new GmailSendError(
      'missing_scope',
      'Google connection cannot write drafts — reconnect from Settings',
    )
  }
  let token: string
  try {
    token = await getAccessToken(userId ?? conn.user_id)
  } catch (err) {
    throw new GmailSendError(
      'no_connection',
      err instanceof Error ? err.message : 'Failed to acquire a Google access token',
    )
  }
  return { conn, token }
}

export async function createGmailDraft(args: GmailDraftArgs): Promise<GmailDraftResult> {
  const { conn, token } = await connect(args.userId)

  const raw = buildMimeMessage({
    to: args.to,
    cc: args.cc,
    subject: args.subject,
    text: args.text,
    html: args.html,
    inReplyTo: args.inReplyTo,
    references: args.references,
    from: conn.email,
  })

  const r = await gmailFetch(GMAIL_DRAFTS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { raw: base64url(raw), threadId: args.threadId } }),
  })

  const json = (await r.json().catch(() => ({}))) as {
    id?: string
    message?: { id?: string; threadId?: string }
    error?: { message?: string; status?: string }
  }

  if (!r.ok) {
    const detail = json.error?.message
      ? `${json.error.status ?? r.status}: ${json.error.message}`
      : `${r.status} ${r.statusText}`
    throw new GmailSendError('gmail_error', detail)
  }
  if (!json.id) {
    throw new GmailSendError('gmail_error', 'Gmail accepted the draft but returned no id')
  }

  // Gmail appends to a thread only when the threadId, the reply headers and the
  // subject all agree; disagree on any one and it silently starts a new
  // conversation instead of refusing. That leaves a stray draft in the
  // attorney's mailbox that looks right in the triage page and is not attached
  // to anything, so the orphan is removed and the failure made loud.
  const landedOn = json.message?.threadId ?? null
  if (landedOn && landedOn !== args.threadId) {
    await deleteGmailDraft(json.id, args.userId).catch(() => {})
    throw new GmailSendError(
      'gmail_error',
      'Gmail put the draft on a new thread instead of the original; it has been removed',
    )
  }

  return {
    draftId: json.id,
    messageId: json.message?.id ?? null,
    threadId: landedOn,
    fromAddress: conn.email,
  }
}

/**
 * Remove a draft. Used when a draft is regenerated after it was already pushed,
 * so the attorney is never left choosing between two drafts on one thread.
 */
export async function deleteGmailDraft(draftId: string, userId?: string | null): Promise<void> {
  const { token } = await connect(userId)
  const r = await gmailFetch(`${GMAIL_DRAFTS_URL}/${encodeURIComponent(draftId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  // Already gone is the outcome asked for. The attorney may well have sent or
  // deleted it in Gmail, which is the whole point of putting it there.
  if (!r.ok && r.status !== 404 && r.status !== 410) {
    throw new GmailSendError('gmail_error', `Failed to delete draft: ${r.status} ${r.statusText}`)
  }
}
