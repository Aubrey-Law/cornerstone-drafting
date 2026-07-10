// Server-side client for Granola's official public API.
//
// Auth: personal API key from Granola desktop → Settings → API (starts with `grn_`).
// Set GRANOLA_API_KEY in the environment.

const GRANOLA_API_BASE = 'https://public-api.granola.ai/v1'

const NOTE_ID_RE = /^not_[a-zA-Z0-9]{14}$/

const LIST_PAGE_SIZE = 30

export interface GranolaDocument {
  id: string
  title: string
  meetingDate: string
  notesMarkdown: string
  attendees: string[]
  sourceUrl: string
}

export interface GranolaNoteSummary {
  id: string
  title: string
  createdAt: string
}

export class GranolaError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function apiKey(): string {
  const key = process.env.GRANOLA_API_KEY
  if (!key) {
    throw new GranolaError(
      503,
      'GRANOLA_API_KEY is not configured — generate one in Granola desktop → Settings → API and set GRANOLA_API_KEY',
    )
  }
  if (!key.startsWith('grn_')) {
    throw new GranolaError(
      503,
      'GRANOLA_API_KEY does not look like a Granola personal API key (should start with "grn_")',
    )
  }
  return key
}

export function isGranolaNoteId(value: string): boolean {
  return NOTE_ID_RE.test(value.trim())
}

async function granolaGet<T>(path: string): Promise<T> {
  const res = await fetch(`${GRANOLA_API_BASE}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: 'application/json',
    },
  })

  if (res.status === 401 || res.status === 403) {
    throw new GranolaError(
      401,
      'Granola rejected the API key — verify GRANOLA_API_KEY is current and your workspace plan supports personal API keys',
    )
  }
  if (res.status === 404) {
    throw new GranolaError(404, 'Granola note not found')
  }
  if (res.status === 429) {
    throw new GranolaError(429, 'Granola rate limit hit — try again in a minute')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new GranolaError(res.status, `Granola API ${res.status}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

interface RawNote {
  id: string
  object?: 'note'
  title?: string | null
  owner?: { name?: string | null; email?: string }
  created_at?: string
  updated_at?: string
  web_url?: string
  calendar_event?: {
    event_title?: string | null
    invitees?: Array<{ name?: string | null; email?: string }>
    scheduled_start_time?: string | null
    scheduled_end_time?: string | null
  } | null
  attendees?: Array<{ name?: string | null; email?: string }>
  summary_text?: string
  summary_markdown?: string | null
}

interface ListNotesResponse {
  notes?: RawNote[]
  hasMore?: boolean
  cursor?: string | null
}

function pickDate(raw: RawNote): string {
  const candidates = [
    raw.calendar_event?.scheduled_start_time,
    raw.created_at,
    raw.updated_at,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    const date = new Date(candidate)
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().slice(0, 10)
    }
  }
  return new Date().toISOString().slice(0, 10)
}

function pickAttendees(raw: RawNote): string[] {
  const list = raw.attendees ?? raw.calendar_event?.invitees ?? []
  return list
    .map((p) => {
      const name = p.name?.trim() ?? null
      const email = p.email?.trim() ?? null
      if (name && email) return `${name} <${email}>`
      return name ?? email ?? ''
    })
    .filter(Boolean)
}

function pickContent(raw: RawNote): string {
  const md = raw.summary_markdown?.trim()
  if (md) return md
  const text = raw.summary_text?.trim()
  if (text) return text
  return ''
}

function toGranolaDocument(raw: RawNote): GranolaDocument {
  const content = pickContent(raw)
  if (!content) {
    throw new GranolaError(
      409,
      'Granola note has no AI summary yet — wait for the meeting to finish processing',
    )
  }
  const title =
    (raw.title?.trim() || raw.calendar_event?.event_title?.trim() || '') || 'Untitled meeting'
  return {
    id: raw.id,
    title,
    meetingDate: pickDate(raw),
    notesMarkdown: content,
    attendees: pickAttendees(raw),
    sourceUrl: raw.web_url ?? 'https://notes.granola.ai/',
  }
}

export async function fetchGranolaNote(noteId: string): Promise<GranolaDocument> {
  if (!isGranolaNoteId(noteId)) {
    throw new GranolaError(
      400,
      'Expected a Granola note id starting with "not_" — Granola web URLs use internal UUIDs that the public API does not accept',
    )
  }
  const raw = await granolaGet<RawNote>(`/notes/${encodeURIComponent(noteId)}`)
  return toGranolaDocument(raw)
}

export async function listRecentNotes(sinceDays = 14): Promise<GranolaNoteSummary[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString()
  const params = new URLSearchParams({
    created_after: since,
    page_size: String(LIST_PAGE_SIZE),
  })
  const body = await granolaGet<ListNotesResponse>(`/notes?${params.toString()}`)
  const notes = body.notes ?? []
  return notes
    .filter((n): n is RawNote & { id: string; created_at: string } =>
      typeof n.id === 'string' && typeof n.created_at === 'string',
    )
    .map((n) => ({
      id: n.id,
      title: n.title?.trim() || 'Untitled meeting',
      createdAt: n.created_at,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}
