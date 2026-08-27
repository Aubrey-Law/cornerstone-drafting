/**
 * The pane's copy of the edit contract.
 *
 * Deliberately a copy, not an import from `lib/drafting/editProtocol.ts`. The
 * add-in is a separate npm project with its own tsconfig and bundler; reaching
 * across into the Next app's `lib/` would drag its module resolution and
 * dependencies (zod, `@/` aliases) into a bundle that ships to Word.
 *
 * `tests/edit-protocol.test.ts` pins the two together, so a change on either
 * side that the other has not made fails the root suite.
 */

export const EDIT_FORMATS = ['bold', 'italic', 'underline', 'heading1', 'heading2', 'heading3'] as const
export type EditFormat = (typeof EDIT_FORMATS)[number]

export interface ProposedEdit {
  original: string
  replacement?: string
  formats?: EditFormat[]
  occurrence?: 'all'
  reason: string
}

export const EDITS_OPEN_TAG = '<EDITS>'
export const EDITS_CLOSE_TAG = '</EDITS>'
export const MAX_ORIGINAL_CHARS = 200
export const MAX_EDITS_PER_RESPONSE = 50

export interface ParsedReply {
  edits: ProposedEdit[]
  prose: string
  malformed: boolean
}

/**
 * Pull the edit block out of a *completed* reply.
 *
 * Never run this on a partial stream. A truncated `original` would still find a
 * match in the document — at the wrong boundary — and the resulting tracked
 * change would look plausible while being wrong.
 */
export function parseEditsBlock(text: string): ParsedReply {
  const open = text.indexOf(EDITS_OPEN_TAG)
  const close = text.indexOf(EDITS_CLOSE_TAG, open + EDITS_OPEN_TAG.length)
  if (open === -1 || close === -1) {
    return { edits: [], prose: text.trim(), malformed: false }
  }

  const inner = text.slice(open + EDITS_OPEN_TAG.length, close).trim()
  // Collapse the seam the removed block leaves behind, so the answer does not
  // show a gap where the transport used to be.
  const prose = (text.slice(0, open) + text.slice(close + EDITS_CLOSE_TAG.length))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const unfenced = inner.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')

  let parsed: unknown
  try {
    parsed = JSON.parse(unfenced)
  } catch {
    return { edits: [], prose, malformed: true }
  }
  if (!Array.isArray(parsed)) return { edits: [], prose, malformed: true }

  const edits = parsed.map(normalizeEdit).filter((e): e is ProposedEdit => e !== null)
  return {
    edits: edits.slice(0, MAX_EDITS_PER_RESPONSE),
    prose,
    malformed: edits.length === 0 && parsed.length > 0,
  }
}

function normalizeEdit(raw: unknown): ProposedEdit | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>

  const original = typeof value.original === 'string' ? value.original : null
  if (!original || original.length === 0 || original.length > MAX_ORIGINAL_CHARS) return null

  const reason = typeof value.reason === 'string' ? value.reason : ''
  const occurrence = value.occurrence === 'all' ? { occurrence: 'all' as const } : {}

  if (typeof value.replacement === 'string') {
    return { original, replacement: value.replacement, reason, ...occurrence }
  }

  const formats = Array.isArray(value.formats)
    ? value.formats.filter((f): f is EditFormat => EDIT_FORMATS.includes(f as EditFormat))
    : []
  if (formats.length > 0) return { original, formats, reason, ...occurrence }

  return null
}
