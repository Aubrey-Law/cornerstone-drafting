import { clearSession, loadSession, signIn } from '../auth/session'
import { parseReviewFrame, type ReviewEvent } from '../review/model'
import type { ScanDecision, ScanEvent, ScanKind } from '../review/scan'

/**
 * Every call is same-origin: the dev server proxies `/api` through to
 * Cornerstone, and in production the pane is served by the Next app. That is
 * deliberate — Word's WebView blocks mixed content, so an HTTPS pane cannot
 * reach a plain-HTTP backend, and going same-origin removes the need for any
 * CORS handling on the Cornerstone side.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * No token is stored at all — distinct from the server rejecting one.
 *
 * These were the same 401 once, and conflating them meant a pane with no
 * session answered its own startup probe by opening a sign-in dialog. There is
 * nothing to refresh here, so this must never trigger a re-authenticate.
 */
export class NotSignedInError extends Error {
  constructor() {
    super('Not signed in')
    this.name = 'NotSignedInError'
  }
}

/** The probe is a background call; it must fail fast rather than hang the pane. */
const PROBE_TIMEOUT_MS = 10_000
/** Matches `maxDuration` on /api/addin/chat. */
const CHAT_TIMEOUT_MS = 120_000
const STYLE_SWEEP_TIMEOUT_MS = 60_000
/** Matches `maxDuration` on the propose route: it is a model call over the whole document. */
const PROPOSE_TIMEOUT_MS = 120_000
/** A whole-document upload to R2; slower than a JSON round trip, bounded by the body limit. */
const VERSION_SAVE_TIMEOUT_MS = 120_000
/** Matches `maxDuration` on /api/addin/review: a playbook is many model calls. */
const REVIEW_TIMEOUT_MS = 300_000

function authHeaders(): Record<string, string> {
  const session = loadSession()
  if (!session) throw new NotSignedInError()
  return { Authorization: `Bearer ${session.accessToken}` }
}

/**
 * Every request gets a deadline.
 *
 * Without one, a stalled dev server or proxy leaves the pane waiting forever
 * with nothing on screen to explain it — which is exactly how the startup probe
 * used to hang.
 */
function deadline(ms: number, caller?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms)
  return caller ? AbortSignal.any([caller, timeout]) : timeout
}

/** Turn an abort into something that names the likely cause. */
function describeAbort(err: unknown, seconds: number): never {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    throw new ApiError(
      `Cornerstone did not respond within ${seconds}s. Is the dev server running at ${window.location.origin}?`,
      504,
    )
  }
  throw err
}

async function describeFailure(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body?.error) return body.error
  } catch {
    /* fall through to the status text */
  }
  return res.statusText || `Request failed (${res.status})`
}

/**
 * Re-authenticate once on a 401, but only when a person is waiting on the call.
 *
 * `interactive` is off by default, and that default is the point. Opening the
 * sign-in dialog is a modal, blocking act: correct when the attorney just hit
 * Send and their token had expired, wrong when a background probe finds a stale
 * token at startup. Doing it there put a dialog on screen nobody asked for and
 * parked the whole pane on it — if that dialog was blocked or landed behind
 * Word, the pane never moved again.
 */
async function withAuthRetry<T>(call: () => Promise<T>, interactive = false): Promise<T> {
  try {
    return await call()
  } catch (err) {
    if (!interactive) throw err
    // A missing token cannot be refreshed, so it is never a retry candidate.
    if (!(err instanceof ApiError) || err.status !== 401) throw err
    clearSession()
    await signIn()
    return call()
  }
}

/**
 * Ask Cornerstone who we are.
 *
 * Deliberately non-interactive: a 401 propagates so the caller can render a
 * sign-in button. Nothing here may open a dialog.
 */
export async function apiGet<T>(path: string): Promise<T> {
  return withAuthRetry(async () => {
    let res: Response
    try {
      res = await fetch(path, {
        headers: authHeaders(),
        cache: 'no-store',
        signal: deadline(PROBE_TIMEOUT_MS),
      })
    } catch (err) {
      describeAbort(err, PROBE_TIMEOUT_MS / 1000)
    }
    if (!res.ok) throw new ApiError(await describeFailure(res), res.status)
    return (await res.json()) as T
  })
}

/**
 * A POST the attorney is waiting on.
 *
 * Interactive, unlike `apiGet`: these are only ever sent by a button press, so
 * re-authenticating in place beats bouncing them to a sign-in button
 * mid-review — and losing a reviewed set of ticked rows to an expired token
 * would mean reading the whole document again.
 */
async function apiPost<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  return withAuthRetry(async () => {
    let res: Response
    try {
      res = await fetch(path, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: deadline(timeoutMs),
      })
    } catch (err) {
      describeAbort(err, timeoutMs / 1000)
    }
    if (!res.ok) throw new ApiError(await describeFailure(res), res.status)
    return (await res.json()) as T
  }, true)
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** One row of the matter picker. Mirrors `GET /api/addin/matters`. */
export interface MatterSummary {
  id: string
  matterNumber: string | null
  clientName: string
  spouseName: string | null
  stage: string
  planType: string | null
  designStatus: string | null
  draftCount: number
}

export interface MatterListResponse {
  matters: MatterSummary[]
  total: number
  truncated: boolean
}

/** The normalized design sheet. Mirrors `GET /api/addin/matters/[id]/brief`. */
export interface MatterBrief {
  matterId: string
  matterNumber: string | null
  clientName: string
  spouseName: string | null
  matterType: string
  practiceArea: string | null
  trustName: string | null
  factSheet: string
  truncated: boolean
}

/**
 * Whether the model was actually given the design sheet for this turn.
 *
 * Reported on every reply rather than assumed from the pane's own state: the
 * brief is built server-side and can fail there — an unready sheet, a matter
 * that is not hired — and an attorney who linked a matter will otherwise read
 * an invented fiduciary as a sourced one.
 */
export type MatterContext =
  | { state: 'none' }
  | { state: 'applied'; matterNumber: string | null; clientName: string }
  | { state: 'unavailable'; reason: string }

export function listMatters(query: string): Promise<MatterListResponse> {
  return apiGet<MatterListResponse>(`/api/addin/matters?q=${encodeURIComponent(query)}`)
}

export function getMatterBrief(matterId: string): Promise<MatterBrief> {
  return apiGet<MatterBrief>(`/api/addin/matters/${encodeURIComponent(matterId)}/brief`)
}

/** One of the matter's Word documents. Mirrors `GET /api/addin/matters/[id]/documents`. */
export interface MatterDocument {
  id: string
  name: string
  size: number
  createdAt: string
  currentVersionId: string | null
  superseded: boolean
}

export interface DocumentVersionRow {
  id: string
  versionNumber: number
  source: string
  sizeBytes: number
  createdAt: string
}

export interface DocumentVersions {
  documentId: string
  name: string
  currentVersionId: string | null
  versions: DocumentVersionRow[]
}

export interface SavedVersion {
  ok: true
  versionId: string
  versionNumber: number
  markerCount: number
  missingCount: number
}

export function listMatterDocuments(matterId: string): Promise<{ documents: MatterDocument[] }> {
  return apiGet(`/api/addin/matters/${encodeURIComponent(matterId)}/documents`)
}

export function getDocumentVersions(documentId: string): Promise<DocumentVersions> {
  return apiGet(`/api/addin/documents/${encodeURIComponent(documentId)}/versions`)
}

/** Upload the open document as the next version of `documentId`. */
export function saveDocumentVersion(
  documentId: string,
  args: { fileBase64: string; baseVersionId: string | null },
): Promise<SavedVersion> {
  return apiPost<SavedVersion>(
    `/api/addin/documents/${encodeURIComponent(documentId)}/versions`,
    args,
    VERSION_SAVE_TIMEOUT_MS,
  )
}

/** One proposed design-sheet change. Mirrors `DesignSheetImportPreviewRow`. */
export interface ProposedFieldRow {
  field: string
  label: string
  section: string
  currentDisplay: string
  proposedDisplay: string
  /** Preselected by the server: false whenever the row would overwrite a value. */
  selected: boolean
  /** True when the sheet already holds a different value for this field. */
  replacement: boolean
}

/** A value the document offered that the field cannot hold. Shown, never applied. */
export interface RejectedFieldRow {
  field: string
  label: string
  section: string
  value: string
  options: readonly string[]
}

export interface DesignSheetProposal {
  preview: ProposedFieldRow[]
  rejected: RejectedFieldRow[]
  proposed: Record<string, unknown>
  /** Compare-and-swap token; handed straight back on apply. */
  sheetId: string | null
  updatedAt: string | null
}

export interface ApplyProposalResult {
  ok: true
  updatedAt: string
  appliedFields: number
}

/** Read the open document for design-sheet decisions. Proposes only; writes nothing. */
export function proposeDesignSheet(
  matterId: string,
  documentText: string,
): Promise<DesignSheetProposal> {
  return apiPost<DesignSheetProposal>(
    `/api/addin/matters/${encodeURIComponent(matterId)}/design-sheet/propose`,
    { documentText },
    PROPOSE_TIMEOUT_MS,
  )
}

/** Write back only the ticked rows, pinned to the sheet the proposal was read from. */
export function applyDesignSheet(
  matterId: string,
  args: { sheetId: string | null; expectedUpdatedAt: string | null; fields: Record<string, unknown> },
): Promise<ApplyProposalResult> {
  return apiPost<ApplyProposalResult>(
    `/api/addin/matters/${encodeURIComponent(matterId)}/design-sheet/apply`,
    args,
    STYLE_SWEEP_TIMEOUT_MS,
  )
}

export interface StreamChatArgs {
  messages: ChatTurn[]
  documentText: string
  documentName: string | null
  /** The linked matter, or null to draft from the document alone. */
  matterId: string | null
  signal?: AbortSignal
  onDelta: (text: string) => void
}

export interface ChatResult {
  reply: string
  matterContext: MatterContext
}

/**
 * Stream one chat turn.
 *
 * Resolves with the complete reply. The caller parses the `<EDITS>` block from
 * that, never from the deltas — a truncated `original` would still find a match
 * in the document, at the wrong boundary.
 */
export async function streamChat(args: StreamChatArgs): Promise<ChatResult> {
  // Interactive: the attorney is watching this one, so re-authenticating in
  // place beats sending them back to a sign-in button mid-sentence.
  return withAuthRetry(async () => {
    let res: Response
    try {
      res = await fetch('/api/addin/chat', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: args.messages,
          documentText: args.documentText,
          documentName: args.documentName,
          matterId: args.matterId,
        }),
        signal: deadline(CHAT_TIMEOUT_MS, args.signal),
      })
    } catch (err) {
      describeAbort(err, CHAT_TIMEOUT_MS / 1000)
    }

    if (!res.ok) throw new ApiError(await describeFailure(res), res.status)
    if (!res.body) throw new ApiError('The server returned an empty stream.', 502)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let reply = ''
    let sawDone = false
    // Absent on a reply from a server that predates matter context. Treated as
    // 'none' rather than assumed applied — the safe direction, since the pane
    // warns on anything that is not 'applied' while a matter is linked.
    let matterContext: MatterContext = { state: 'none' }

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE frames are separated by a blank line; the last chunk may be partial.
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        const line = frame.split('\n').find(l => l.startsWith('data: '))
        if (!line) continue

        let payload: {
          delta?: string
          done?: boolean
          reply?: string
          error?: string
          matterContext?: MatterContext
        }
        try {
          payload = JSON.parse(line.slice(6))
        } catch {
          continue
        }

        if (payload.error) throw new ApiError(payload.error, 500)
        if (typeof payload.delta === 'string') {
          reply += payload.delta
          args.onDelta(payload.delta)
        }
        if (payload.done) {
          sawDone = true
          // The terminal frame carries the authoritative reply; deltas can be
          // dropped by an intermediary, and a partial reply must not be parsed
          // for edits.
          if (typeof payload.reply === 'string') reply = payload.reply
          if (payload.matterContext) matterContext = payload.matterContext
        }
      }
    }

    if (!sawDone) {
      throw new ApiError('The connection dropped before the reply finished.', 502)
    }
    return { reply, matterContext }
  }, true)
}

export interface StyleSweepResponse {
  noOp: boolean
  changedParts: string[]
  fileBase64?: string
}

/** Send the open document up for the firm style sweep and get the bytes back. */
export async function postStyleSweep(fileBase64: string): Promise<StyleSweepResponse> {
  // Interactive: the attorney clicked Apply and is waiting.
  return withAuthRetry(async () => {
    let res: Response
    try {
      res = await fetch('/api/addin/style-set/apply', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64 }),
        signal: deadline(STYLE_SWEEP_TIMEOUT_MS),
      })
    } catch (err) {
      describeAbort(err, STYLE_SWEEP_TIMEOUT_MS / 1000)
    }
    if (!res.ok) throw new ApiError(await describeFailure(res), res.status)
    return (await res.json()) as StyleSweepResponse
  }, true)
}

/** One published review playbook. Mirrors `GET /api/addin/playbooks`. */
export interface PlaybookSummary {
  slug: string
  title: string
  version: number
  ruleCount: number
}

export function listPlaybooks(): Promise<{ playbooks: PlaybookSummary[] }> {
  return apiGet('/api/addin/playbooks')
}

export interface StreamReviewArgs {
  paragraphs: string[]
  playbookSlug: string
  matterId: string | null
  /** The open .docx, base64, kept as the saved review's snapshot. Omitted: the review runs unsaved. */
  fileBase64?: string | null
  documentName?: string | null
  /** The Cornerstone document this file is linked to, if any. */
  documentId?: string | null
  signal?: AbortSignal
  onEvent: (event: ReviewEvent) => void
}

/**
 * Run a playbook against the open document, reporting each rule as it settles.
 *
 * Resolves once the server's terminal frame arrives; a stream that ends
 * without one is reported as dropped, so a half-finished review is never shown
 * as a complete one.
 */
export async function streamReview(args: StreamReviewArgs): Promise<void> {
  return withAuthRetry(async () => {
    let res: Response
    try {
      res = await fetch('/api/addin/review', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paragraphs: args.paragraphs,
          playbookSlug: args.playbookSlug,
          matterId: args.matterId,
          fileBase64: args.fileBase64 ?? undefined,
          documentName: args.documentName ?? undefined,
          documentId: args.documentId ?? undefined,
        }),
        signal: deadline(REVIEW_TIMEOUT_MS, args.signal),
      })
    } catch (err) {
      describeAbort(err, REVIEW_TIMEOUT_MS / 1000)
    }
    if (!res.ok) throw new ApiError(await describeFailure(res), res.status)
    if (!res.body) throw new ApiError('The server returned an empty stream.', 502)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let sawDone = false

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const event = parseReviewFrame(frame)
        if (!event) continue
        if ('done' in event || 'error' in event) sawDone = true
        args.onEvent(event)
      }
    }

    if (!sawDone) throw new ApiError('The connection dropped before the review finished.', 502)
  }, true)
}

export interface StreamScanArgs {
  kind: ScanKind
  paragraphs: string[]
  matterId: string | null
  /** A review's saved copy of this document, to save the scan against. */
  reviewUploadId?: string | null
  /** Or the open .docx, base64, for a saved copy of the scan's own. Neither: the scan runs unsaved. */
  fileBase64?: string | null
  documentName?: string | null
  documentId?: string | null
  signal?: AbortSignal
  onEvent: (event: ScanEvent) => void
}

/**
 * Issue spotting or proofreading over the open document, reporting items as
 * each section settles. The same stream shape as `streamReview`, and the same
 * `data: {...}` frames, so the same parser reads them.
 */
export async function streamScan(args: StreamScanArgs): Promise<void> {
  return withAuthRetry(async () => {
    let res: Response
    try {
      res = await fetch('/api/addin/scan', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: args.kind,
          paragraphs: args.paragraphs,
          matterId: args.matterId,
          reviewUploadId: args.reviewUploadId ?? undefined,
          fileBase64: args.fileBase64 ?? undefined,
          documentName: args.documentName ?? undefined,
          documentId: args.documentId ?? undefined,
        }),
        signal: deadline(REVIEW_TIMEOUT_MS, args.signal),
      })
    } catch (err) {
      describeAbort(err, REVIEW_TIMEOUT_MS / 1000)
    }
    if (!res.ok) throw new ApiError(await describeFailure(res), res.status)
    if (!res.body) throw new ApiError('The server returned an empty stream.', 502)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let sawDone = false

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const event = parseReviewFrame(frame) as unknown as ScanEvent | null
        if (!event) continue
        if ('done' in event || 'error' in event) sawDone = true
        args.onEvent(event)
      }
    }

    if (!sawDone) throw new ApiError('The connection dropped before the check finished.', 502)
  }, true)
}

/**
 * Records a decision made in Word on a saved check's item, in its review
 * history. A 404 means the item is not saved (its section still being written,
 * or saving stopped part-way); the caller says the decision stays in Word.
 */
export function saveScanDecision(args: {
  scanId: string
  itemKey: string
  disposition: ScanDecision
  note?: string | null
}): Promise<{ ok: true; itemId: string }> {
  return apiPost<{ ok: true; itemId: string }>(
    '/api/addin/scan/decision',
    { scanId: args.scanId, itemKey: args.itemKey, disposition: args.disposition, note: args.note ?? undefined },
    PROBE_TIMEOUT_MS,
  )
}
