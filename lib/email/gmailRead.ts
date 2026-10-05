import {
  getAccessToken,
  getGoogleConnectionForUser,
  hasGmailModifyScope,
} from '@/lib/googleCalendar'

/**
 * Read the firm's mailbox through the connected Google account.
 *
 * The mirror of `gmailSend.ts`, and deliberately the only module that reads
 * mail: everything downstream of it works on the parsed shapes below rather
 * than on Gmail's wire format, so the triage rules stay testable without a
 * Google account.
 *
 * Nothing here writes. Creating the reply draft is `createGmailDraft` in
 * `gmailSend.ts`, beside the send path it shares its MIME builder with.
 */

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'
const GMAIL_TIMEOUT_MS = 20_000

/** Gmail caps `maxResults` at 500 per page; 100 keeps each response small. */
const PAGE_SIZE = 100

/**
 * Bodies are read to be summarised, not archived. A message longer than this
 * is a newsletter, a court notice with the whole docket pasted in, or a thread
 * whose quoted chain survived stripping — none of which get better answers from
 * more tokens.
 */
const MAX_BODY_CHARS = 20_000

/**
 * Headers worth asking for in a metadata fetch. Everything the needs-reply rule
 * and the automated-sender filter read, and nothing else.
 */
const METADATA_HEADERS = [
  'From', 'To', 'Cc', 'Subject', 'Date',
  'Message-ID', 'References', 'In-Reply-To',
  'List-Unsubscribe', 'List-Id', 'List-Post',
  'Precedence', 'Auto-Submitted', 'Return-Path',
  'X-Mailer', 'Feedback-ID',
] as const

/**
 * The triage scan window.
 *
 * A constant rather than a parameter so every scan — cron, manual refresh,
 * test — asks Gmail the same question, and a queue that looks wrong can be
 * reproduced by pasting this into the Gmail search box.
 *
 * `-in:chats` drops Hangouts/Chat rows, which are threads with no headers and
 * would otherwise fail parsing. The category exclusions are Gmail's own
 * bulk-mail classification, which is a far better newsletter filter than
 * anything header-based, and `triageClassify.ts` catches the rest.
 */
export const TRIAGE_SEARCH_QUERY =
  'in:inbox -in:chats -category:promotions -category:social -category:forums newer_than:14d'

export type GmailReadErrorKind =
  | 'no_connection'
  | 'missing_scope'
  | 'rate_limited'
  | 'gmail_error'

export class GmailReadError extends Error {
  readonly kind: GmailReadErrorKind
  constructor(kind: GmailReadErrorKind, message: string) {
    super(message)
    this.kind = kind
    this.name = 'GmailReadError'
  }
}

export interface GmailAddress {
  name: string | null
  email: string
}

export interface GmailMessageSummary {
  id: string
  threadId: string
  from: GmailAddress
  to: GmailAddress[]
  cc: GmailAddress[]
  subject: string
  snippet: string
  /** ISO 8601, from Gmail's `internalDate`. */
  receivedAt: string
  messageIdHeader: string | null
  references: string | null
  inReplyTo: string | null
  /** Lowercased header names, for `list-unsubscribe`, `precedence` and friends. */
  headers: Record<string, string>
  /** Decoded, HTML-stripped, with the quoted reply chain removed. */
  bodyText: string
  labelIds: string[]
}

export interface GmailThreadSummary {
  id: string
  messages: GmailMessageSummary[]
}

/* -------------------------------------------------------------------------- */
/* Wire format                                                                 */
/* -------------------------------------------------------------------------- */

interface RawHeader {
  name?: string
  value?: string
}

interface RawPart {
  mimeType?: string
  filename?: string
  headers?: RawHeader[]
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: RawPart[]
}

interface RawMessage {
  id?: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: RawPart
}

/* -------------------------------------------------------------------------- */
/* Parsing — exported for tests, since this is where the bugs live             */
/* -------------------------------------------------------------------------- */

/**
 * Gmail decodes Content-Transfer-Encoding for us but does **not** normalise
 * charset, so a part that arrived as ISO-8859-1 comes back as ISO-8859-1
 * bytes. Reading those as UTF-8 is how a client's apostrophes turn into
 * `â€™` in the draft the attorney is about to send.
 */
export function charsetToEncoding(contentType: string | undefined): BufferEncoding {
  const match = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType ?? '')
  const charset = (match?.[1] ?? 'utf-8').toLowerCase()
  if (charset === 'iso-8859-1' || charset === 'latin1' || charset === 'windows-1252') {
    return 'latin1'
  }
  if (charset === 'us-ascii' || charset === 'ascii') return 'ascii'
  return 'utf-8'
}

/**
 * Gmail encodes bodies base64url — `-`/`_` for `+`/`/`, padding stripped.
 * `Buffer` understands that directly; the guard is for parts Gmail sends with
 * no data at all (an attachment stub, or an empty body).
 */
export function decodeBase64Url(
  data: string | null | undefined,
  encoding: BufferEncoding = 'utf-8',
): string {
  if (!data) return ''
  try {
    return Buffer.from(data, 'base64url').toString(encoding)
  } catch {
    return ''
  }
}

export function headersToMap(headers: RawHeader[] | undefined): Record<string, string> {
  const map: Record<string, string> = {}
  for (const h of headers ?? []) {
    if (!h.name) continue
    // Gmail preserves repeated headers (Received, most often). First wins: for
    // the headers triage cares about a repeat is malformed, and taking the
    // first matches what a mail client would display.
    const key = h.name.toLowerCase()
    if (map[key] === undefined) map[key] = h.value ?? ''
  }
  return map
}

/**
 * Parse one RFC 5322 address. Handles `Name <a@b>`, `"Last, First" <a@b>` and
 * a bare `a@b`; anything else yields the raw string as the email, which is
 * enough for the sender never to match a client and so to be treated as
 * unknown rather than silently mis-attributed.
 */
export function parseAddress(raw: string | null | undefined): GmailAddress | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  const angled = value.match(/^(.*)<([^>]+)>\s*$/)
  if (angled) {
    const name = angled[1].trim().replace(/^"(.*)"$/, '$1').trim()
    return { name: name || null, email: angled[2].trim().toLowerCase() }
  }
  return { name: null, email: value.toLowerCase() }
}

/**
 * Split an address header on commas that are not inside a quoted display name
 * — `"Doe, Jane" <jane@x>` is one recipient, not two.
 */
export function parseAddressList(raw: string | null | undefined): GmailAddress[] {
  const value = raw ?? ''
  const out: GmailAddress[] = []
  let current = ''
  let quoted = false
  for (const ch of value) {
    if (ch === '"') quoted = !quoted
    if (ch === ',' && !quoted) {
      const parsed = parseAddress(current)
      if (parsed) out.push(parsed)
      current = ''
      continue
    }
    current += ch
  }
  const last = parseAddress(current)
  if (last) out.push(last)
  return out
}

/** Crude but sufficient: triage reads prose, never renders it. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Walk a MIME tree for the message body.
 *
 * `text/plain` wins when it is there; `text/html` is the fallback, because a
 * message with only an HTML part is common and dropping it would leave the
 * draft with nothing to answer. Parts carrying a `filename` are attachments and
 * are skipped whatever their type — a PDF is not the body of the email.
 */
export function extractBody(payload: RawPart | undefined): string {
  const plain: string[] = []
  const html: string[] = []

  const walk = (part: RawPart | undefined) => {
    if (!part) return
    // A part with a filename or an attachment stub is a file, whatever its
    // MIME type says. A client's PDF is not the body of their email, and
    // triage never downloads attachments at all.
    if (part.filename || part.body?.attachmentId) return
    const mime = (part.mimeType ?? '').toLowerCase()
    if (mime.startsWith('multipart/')) {
      for (const child of part.parts ?? []) walk(child)
      return
    }
    const partHeaders = headersToMap(part.headers)
    const decoded = decodeBase64Url(part.body?.data, charsetToEncoding(partHeaders['content-type']))
    if (!decoded) return
    if (mime === 'text/plain') plain.push(decoded)
    else if (mime === 'text/html') html.push(decoded)
  }

  walk(payload)
  const text = plain.length ? plain.join('\n').trim() : htmlToText(html.join('\n'))
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}\n\n[truncated]` : text
}

const QUOTE_MARKERS: RegExp[] = [
  // "On Tue, 3 Sep 2026 at 10:04, Jane <jane@x> wrote:"
  /^\s*On\s.+\bwrote:\s*$/,
  /^\s*-{2,}\s*Original Message\s*-{2,}/i,
  /^\s*-{2,}\s*Forwarded message\s*-{2,}/i,
  // Outlook's horizontal rule above its quoted header block.
  /^\s*_{10,}\s*$/,
]

/**
 * Outlook's quoted block opens with `From:` and is followed within a few lines
 * by the rest of the header set. The corroborating line is required: a client
 * writing "From: the trustee's perspective, this seems wrong" opens a line with
 * `From:` too, and cutting there would throw away the question being asked.
 */
const OUTLOOK_BLOCK_FOLLOWERS = /^\s*(Sent|Date|To|Subject|Cc):\s/

/**
 * Cut the quoted reply chain off the bottom of a message.
 *
 * Worth doing carefully: without it every draft prompt carries the whole thread
 * twice — once as the thread the model is given, once inside each message's own
 * quoted tail — which is both expensive and a good way to have the model answer
 * a question that was already answered three replies ago.
 *
 * A bare `>` line only counts once two of them appear in a row, so a single
 * line of prose that happens to start with `>` does not truncate the message.
 *
 * If stripping leaves almost nothing, the unstripped text is returned instead.
 * "Yes — see below." above a quoted chain is an ordinary reply, and reducing it
 * to an empty string would have the model answer a message it cannot see.
 */
export function stripQuotedChain(body: string): string {
  const lines = body.split(/\r?\n/)
  const cutAt = (i: number) => lines.slice(0, i).join('\n').trim()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let cut: string | null = null

    if (QUOTE_MARKERS.some(marker => marker.test(line))) cut = cutAt(i)
    // "On <date>," wrapped onto the next line before "... wrote:".
    else if (/^\s*On\s.+,\s*$/.test(line) && /\bwrote:\s*$/.test(lines[i + 1] ?? '')) cut = cutAt(i)
    else if (
      /^\s*From:\s.+$/.test(line)
      && lines.slice(i + 1, i + 5).some(next => OUTLOOK_BLOCK_FOLLOWERS.test(next))
    ) cut = cutAt(i)
    else if (/^\s*>/.test(line) && /^\s*>/.test(lines[i + 1] ?? '')) cut = cutAt(i)

    if (cut !== null) {
      return cut.replace(/\s/g, '').length >= 20 ? cut : body.trim()
    }
  }
  return body.trim()
}

export function parseMessage(raw: RawMessage): GmailMessageSummary | null {
  if (!raw.id || !raw.threadId) return null
  const headers = headersToMap(raw.payload?.headers)
  const from = parseAddress(headers.from)
  if (!from) return null

  const internalMs = Number(raw.internalDate ?? '')
  const receivedAt = Number.isFinite(internalMs) && internalMs > 0
    ? new Date(internalMs).toISOString()
    : new Date(0).toISOString()

  return {
    id: raw.id,
    threadId: raw.threadId,
    from,
    to: parseAddressList(headers.to),
    cc: parseAddressList(headers.cc),
    subject: headers.subject ?? '',
    snippet: raw.snippet ?? '',
    receivedAt,
    messageIdHeader: headers['message-id'] ?? null,
    references: headers.references ?? null,
    inReplyTo: headers['in-reply-to'] ?? null,
    headers,
    bodyText: stripQuotedChain(extractBody(raw.payload)),
    labelIds: raw.labelIds ?? [],
  }
}

export function parseThread(raw: { id?: string; messages?: RawMessage[] }): GmailThreadSummary | null {
  if (!raw.id) return null
  const messages = (raw.messages ?? [])
    .map(parseMessage)
    .filter((m): m is GmailMessageSummary => m !== null)
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
  if (!messages.length) return null
  return { id: raw.id, messages }
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The connected account's own address, which is what tells an inbound message
 * from one the attorney sent. Returned alongside the read token because every
 * caller needs both and neither is worth fetching twice.
 */
export async function getMailboxIdentity(
  userId?: string | null,
): Promise<{ token: string; address: string; userId: string | null }> {
  const conn = await getGoogleConnectionForUser(userId)
  if (!conn) {
    throw new GmailReadError('no_connection', 'Google account is not connected')
  }
  if (!hasGmailModifyScope(conn.scopes)) {
    throw new GmailReadError(
      'missing_scope',
      'Google connection cannot read the mailbox — reconnect from Settings',
    )
  }
  let token: string
  try {
    token = await getAccessToken(userId ?? conn.user_id)
  } catch (err) {
    throw new GmailReadError(
      'no_connection',
      err instanceof Error ? err.message : 'Failed to acquire a Google access token',
    )
  }

  // `users.getProfile`, not the stored `conn.email`. The stored value comes
  // from the OpenID userinfo endpoint and is the Google *account* address,
  // which is not always the address Gmail delivers to. Get that wrong and every
  // message reads as inbound, including the attorney's own replies, so the
  // queue never drains. `conn.email` is the fallback, not the answer.
  const profile = await gmailGet('/profile', token)
  const address = ((profile.emailAddress as string | undefined) ?? conn.email ?? '').toLowerCase()
  if (!address) {
    throw new GmailReadError('no_connection', 'Google connection has no mailbox address')
  }
  return { token, address, userId: conn.user_id ?? null }
}

async function gmailGet(path: string, token: string): Promise<Record<string, unknown>> {
  let r: Response
  try {
    r = await fetch(`${GMAIL_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(GMAIL_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new GmailReadError('gmail_error', 'Gmail request timed out')
    }
    throw new GmailReadError('gmail_error', err instanceof Error ? err.message : 'Gmail read failed')
  }

  const json = (await r.json().catch(() => ({}))) as {
    error?: { message?: string; status?: string; errors?: { reason?: string }[] }
  } & Record<string, unknown>

  if (!r.ok) {
    const reason = json.error?.errors?.[0]?.reason ?? ''
    // 403 is overloaded: a quota bounce and a revoked grant arrive with the
    // same status and only the reason separates them. Backing off on a
    // permission error would retry forever; failing on a quota bounce would
    // abandon a scan that a minute's wait would have completed.
    if (r.status === 429 || /rateLimitExceeded|userRateLimitExceeded|backendError/i.test(reason)) {
      throw new GmailReadError('rate_limited', `Gmail rate limit: ${json.error?.message ?? r.status}`)
    }
    const detail = json.error?.message
      ? `${json.error.status ?? r.status}: ${json.error.message}`
      : `${r.status} ${r.statusText}`
    throw new GmailReadError('gmail_error', detail)
  }
  return json
}

/**
 * Thread ids matching a Gmail search, newest first (Gmail's own order).
 *
 * Ids only: the list endpoint returns no headers and no body, so every caller
 * has to fetch each thread anyway, and returning half-populated threads here
 * would invite someone to classify on data that is not there.
 */
export async function listTriageThreadIds(args: {
  userId?: string | null
  token?: string
  query?: string
  maxResults: number
}): Promise<string[]> {
  const token = args.token ?? (await getMailboxIdentity(args.userId)).token
  const query = args.query ?? TRIAGE_SEARCH_QUERY
  const ids: string[] = []
  let pageToken: string | undefined

  while (ids.length < args.maxResults) {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(Math.min(PAGE_SIZE, args.maxResults - ids.length)),
    })
    if (pageToken) params.set('pageToken', pageToken)

    const json = await gmailGet(`/threads?${params.toString()}`, token)
    const threads = (json.threads as { id?: string }[] | undefined) ?? []
    for (const t of threads) {
      if (t.id) ids.push(t.id)
    }
    pageToken = (json.nextPageToken as string | undefined) ?? undefined
    if (!pageToken || threads.length === 0) break
  }

  return ids.slice(0, args.maxResults)
}

/**
 * One thread, headers only — `bodyText` comes back empty.
 *
 * The scan runs on this, and that is a privacy decision as much as a quota one:
 * classification and the needs-reply rule read headers and labels, so a
 * newsletter's body, or a vendor's, is never downloaded at all. Only threads
 * that survive to drafting or that the attorney opens get `getThread`.
 */
export async function getThreadMetadata(args: {
  userId?: string | null
  token?: string
  threadId: string
}): Promise<GmailThreadSummary | null> {
  const token = args.token ?? (await getMailboxIdentity(args.userId)).token
  const params = new URLSearchParams({ format: 'metadata' })
  for (const name of METADATA_HEADERS) params.append('metadataHeaders', name)
  const json = await gmailGet(
    `/threads/${encodeURIComponent(args.threadId)}?${params.toString()}`,
    token,
  )
  return parseThread(json as { id?: string; messages?: RawMessage[] })
}

/**
 * One thread with bodies. Called for the threads that reach drafting, and when
 * the attorney opens a row — bodies are not stored, so the page reads them live.
 */
export async function getThread(args: {
  userId?: string | null
  token?: string
  threadId: string
}): Promise<GmailThreadSummary | null> {
  const token = args.token ?? (await getMailboxIdentity(args.userId)).token
  const json = await gmailGet(`/threads/${encodeURIComponent(args.threadId)}?format=full`, token)
  return parseThread(json as { id?: string; messages?: RawMessage[] })
}
