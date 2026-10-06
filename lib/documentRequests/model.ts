/**
 * Document requests: what the firm has asked the client to send, and where
 * each item stands. Pure, so the rules that decide what the client is shown
 * and what counts as outstanding are tested without a database.
 */

export const DOCUMENT_REQUEST_STATUSES = ['requested', 'received', 'accepted', 'waived'] as const
export type DocumentRequestStatus = (typeof DOCUMENT_REQUEST_STATUSES)[number]

export const DOCUMENT_REQUEST_SOURCES = ['staff', 'meeting_notes', 'automation'] as const
export type DocumentRequestSource = (typeof DOCUMENT_REQUEST_SOURCES)[number]

export interface DocumentRequest {
  id: string
  matterId: string
  title: string
  description: string | null
  dueOn: string | null
  status: DocumentRequestStatus
  source: DocumentRequestSource
  requestedAt: string
  receivedDocumentId: string | null
  receivedAt: string | null
  acceptedAt: string | null
  waivedAt: string | null
  waivedReason: string | null
}

export function isDocumentRequestStatus(value: unknown): value is DocumentRequestStatus {
  return typeof value === 'string' && (DOCUMENT_REQUEST_STATUSES as readonly string[]).includes(value)
}

/** Still wanted from the client: asked for, or arrived but not yet looked at. */
export const OPEN_REQUEST_STATUSES: readonly DocumentRequestStatus[] = ['requested', 'received']

/** The client still has something to do: nothing has arrived yet. */
export function awaitsClient(request: Pick<DocumentRequest, 'status'>): boolean {
  return request.status === 'requested'
}

/** Staff still have something to do: it arrived and has not been accepted or waived. */
export function awaitsStaff(request: Pick<DocumentRequest, 'status'>): boolean {
  return request.status === 'received'
}

/** What the client reads as the status line under a request. */
export function clientStatusLabel(request: Pick<DocumentRequest, 'status' | 'dueOn'>, today?: string): string {
  switch (request.status) {
    case 'requested':
      if (request.dueOn && today && request.dueOn < today) return `Overdue (was due ${request.dueOn})`
      return request.dueOn ? `Due ${request.dueOn}` : 'Requested'
    case 'received':
      return 'Received, being reviewed'
    case 'accepted':
      return 'Accepted'
    case 'waived':
      return 'No longer needed'
  }
}

/** The form a request title takes whatever it was typed or extracted as. */
export function normaliseRequestTitle(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim().replace(/[.;:,\s]+$/, '')
  if (!flat) return ''
  const capped = flat.length > 160 ? `${flat.slice(0, 157).trimEnd()}…` : flat
  return capped.charAt(0).toUpperCase() + capped.slice(1)
}

/**
 * Turn what the client agreed to send, as the meeting follow-up read it, into
 * request titles: one per sentence, cleaned and deduplicated, at most ten.
 */
export function requestTitlesFromClientItems(items: readonly string[]): string[] {
  const seen = new Set<string>()
  const titles: string[] = []
  for (const item of items) {
    const title = normaliseRequestTitle(item)
    const key = title.toLowerCase()
    if (!title || seen.has(key)) continue
    seen.add(key)
    titles.push(title)
    if (titles.length === 10) break
  }
  return titles
}

/**
 * A request that already exists for the same ask, so a second meeting about
 * the same deed does not add a second row.
 */
export function findMatchingRequest<T extends Pick<DocumentRequest, 'title' | 'status'>>(
  requests: readonly T[],
  title: string,
): T | null {
  const key = normaliseRequestTitle(title).toLowerCase()
  return requests.find(request => request.status !== 'waived' && normaliseRequestTitle(request.title).toLowerCase() === key) ?? null
}

export interface DocumentRequestSummary {
  open: number
  awaitingClient: number
  awaitingStaff: number
  accepted: number
  /** The soonest due date among requests the client still owes, or null. */
  nextDueOn: string | null
}

export function summariseDocumentRequests(requests: readonly Pick<DocumentRequest, 'status' | 'dueOn'>[]): DocumentRequestSummary {
  const owed = requests.filter(awaitsClient)
  const dueDates = owed.map(request => request.dueOn).filter((value): value is string => Boolean(value)).sort()
  return {
    open: requests.filter(request => OPEN_REQUEST_STATUSES.includes(request.status)).length,
    awaitingClient: owed.length,
    awaitingStaff: requests.filter(awaitsStaff).length,
    accepted: requests.filter(request => request.status === 'accepted').length,
    nextDueOn: dueDates[0] ?? null,
  }
}
