import type { EditInput } from '../docxTrackedChanges'

/**
 * The one vocabulary in which a model proposes a document revision.
 *
 * Two very different appliers consume it. `/api/documents/[id]/edits` rewrites
 * OOXML on the server for documents living in R2; the Word add-in searches the
 * live document with Office.js. Sharing the *proposal* contract (and the prompt
 * that produces it) keeps those two from drifting into subtly different rules
 * about what a model is allowed to ask for, which is the failure mode that
 * makes edits land in the wrong place.
 *
 * The applies stay separate on purpose — they have nothing in common beyond
 * this shape.
 */

export const EDIT_FORMATS = ['bold', 'italic', 'underline', 'heading1', 'heading2', 'heading3'] as const
export type EditFormat = (typeof EDIT_FORMATS)[number]

export interface ProposedEdit {
  /**
   * Text copied character-for-character from the document, used as the search
   * key. Must be contiguous within a single paragraph and unique in the
   * document.
   */
  original: string
  /** Replacement text. `''` deletes the passage. Mutually exclusive with `formats`. */
  replacement?: string
  /** Restyle the passage instead of rewriting it. Mutually exclusive with `replacement`. */
  formats?: EditFormat[]
  /** Explicit replace-all opt-in. Any other value is invalid. */
  occurrence?: 'all'
  /** One short sentence explaining the change, shown on the edit card. */
  reason: string
}

/**
 * Word's `Range.search()` rejects strings past ~255 characters. The cap sits at
 * 200 so a model that overshoots slightly still produces a searchable edit
 * rather than one that fails at the host boundary.
 */
export const MAX_ORIGINAL_CHARS = 200
export const MAX_REPLACEMENT_CHARS = 10_000
export const MAX_EDITS_PER_RESPONSE = 50

/**
 * How far the live Word document is truncated before it reaches the model.
 * The pane sends the whole body, so this is the real ceiling.
 */
export const MAX_DOCUMENT_CONTEXT_CHARS = 200_000

/**
 * The server-side redline route's own, lower ceiling. Kept distinct because
 * raising it changes the cost and context pressure of an endpoint that has
 * been running at 80k; the two limits answer to different callers.
 */
export const MAX_CONTEXT_ANCHORED_DOCUMENT_CHARS = 80_000

export const EDITS_OPEN_TAG = '<EDITS>'
export const EDITS_CLOSE_TAG = '</EDITS>'

/**
 * Rules that hold whichever applier runs, kept in one string so the two
 * prompts below cannot drift apart on the parts that actually matter.
 */
const SHARED_EDIT_RULES = `- Prefer a few precise edits over a broad rewrite.
- Do not invent parties, fiduciary names, dollar amounts, or dates that the document and the attorney's instruction do not support.`

/**
 * The protocol section of the system prompt.
 *
 * Every constraint here exists because violating it produces an edit that
 * cannot be located or cannot be reviewed:
 *
 * - non-verbatim / non-contiguous / non-unique `original` → the search misses
 *   or matches the wrong passage;
 * - over-long `original` → Word's search API rejects it outright;
 * - editing a list number → Word owns list numbering, so the "change" is a
 *   no-op that still leaves a revision behind.
 */
export function buildEditProtocolInstructions(): string {
  return `DOCUMENT EDITS

When the attorney asks you to change the document, emit exactly one JSON array of edits, wrapped in ${EDITS_OPEN_TAG} and ${EDITS_CLOSE_TAG} tags, before your prose summary:

${EDITS_OPEN_TAG}
[
  {"original":"exact text copied from the document","replacement":"new text","reason":"one short sentence"},
  {"original":"exact text copied from the document","formats":["bold"],"reason":"one short sentence"}
]
${EDITS_CLOSE_TAG}

- Every edit requires "original" and a concise "reason", plus exactly one of "replacement" or "formats". Valid formats are ${EDIT_FORMATS.map(f => `"${f}"`).join(', ')}.
- Copy "original" character-for-character from one contiguous passage within a single paragraph. Preserve capitalization, punctuation, and spacing. Keep it at most ${MAX_ORIGINAL_CHARS} characters.
- Use the shortest passage that covers the change AND occurs exactly once in the document. If no unique short passage exists, extend it with surrounding words until it does. If you still cannot make it unique, ask which occurrence the attorney means instead of guessing.
- Use "replacement":"" to delete a passage. To delete a whole paragraph or list item, quote all of its text. Never edit a list number — Word maintains numbering itself.
- Set "occurrence":"all" only when the attorney explicitly asks to replace every instance. No other value is valid.
- Keep related changes in one edit when a short contiguous passage covers them; keep unrelated changes separate so each can be accepted or rejected on its own.
- Formats style the whole paragraph for heading1/heading2/heading3. Do not apply one when the target shares a paragraph with body text.
- Emit at most ${MAX_EDITS_PER_RESPONSE} edits. Use strict JSON with no markdown fences or comments.
- Emit the block only when you are proposing a change. Never claim the document changed without emitting it, and never describe the raw ${EDITS_OPEN_TAG} block to the attorney — the pane renders it as review cards.
${SHARED_EDIT_RULES}`
}

interface ParsedEdits {
  /** Valid edits, in the order the model emitted them. */
  edits: ProposedEdit[]
  /** The answer text with the transport block removed, for display. */
  prose: string
  /**
   * True when a block was present but could not be parsed. Distinguishes "the
   * model proposed nothing" from "the model proposed something and we dropped
   * it", which the caller should surface rather than silently ignore.
   */
  malformed: boolean
}

/**
 * Pull the edit block out of a completed model response.
 *
 * Deliberately only ever run on a *finished* response. Parsing a partial
 * stream risks applying a half-written edit whose `original` is truncated —
 * which would still find a match, at the wrong boundary.
 */
export function parseEditsBlock(text: string): ParsedEdits {
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

  // Tolerate a model that fences the JSON despite being told not to.
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
    // A block that yielded nothing usable is a failure, not an empty proposal.
    malformed: edits.length === 0 && parsed.length > 0,
  }
}

function normalizeEdit(raw: unknown): ProposedEdit | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>

  const original = typeof value.original === 'string' ? value.original : null
  if (!original || original.length === 0 || original.length > MAX_ORIGINAL_CHARS) return null

  const reason = typeof value.reason === 'string' ? value.reason : ''

  const formats = Array.isArray(value.formats)
    ? value.formats.filter((f): f is EditFormat => EDIT_FORMATS.includes(f as EditFormat))
    : []

  // `replacement` and `formats` are mutually exclusive; a text replacement
  // wins when a confused model sends both, because it is the visible change.
  const hasReplacement = typeof value.replacement === 'string'
  if (hasReplacement) {
    const replacement = value.replacement as string
    if (replacement.length > MAX_REPLACEMENT_CHARS) return null
    return {
      original,
      replacement,
      reason,
      ...(value.occurrence === 'all' ? { occurrence: 'all' as const } : {}),
    }
  }

  if (formats.length > 0) {
    return {
      original,
      formats,
      reason,
      ...(value.occurrence === 'all' ? { occurrence: 'all' as const } : {}),
    }
  }

  return null
}

/**
 * The prompt for the server-side OOXML applier at `/api/documents/[id]/edits`.
 *
 * Deliberately NOT the `<EDITS>` protocol above. That applier disambiguates
 * with surrounding context, so it can accept a short non-unique `find` that
 * Word's search-based applier could never locate — and it supports a pure
 * insert (`find: ""`) that has no search-based equivalent. Feeding it the
 * stricter Word rules would throw away capability it already has.
 *
 * The two live in one file so a change to the shared rules is one diff, and so
 * the difference between them is visible rather than accidental.
 */
export function buildContextAnchoredEditPrompt(args: {
  documentText: string
  instruction: string
}): string {
  return `You are editing an estate-planning Word document using find/replace with short context anchors.

Document text (accepted view, paragraphs separated by newlines):
---
${args.documentText}
---

Attorney instruction:
${args.instruction}

Return ONLY a JSON array of edit objects (no markdown), each:
{"find":"...","replace":"...","context_before":"...","context_after":"...","reason":"..."}

Rules:
- find should be the minimal unique phrase to change (or "" for pure insert with context).
- context_before and context_after should be ~20-40 characters of surrounding text for disambiguation.
${SHARED_EDIT_RULES}`
}

/**
 * Adapt a proposal to the server-side OOXML applier in `lib/docxTrackedChanges`.
 *
 * That applier disambiguates with surrounding context rather than requiring a
 * globally unique needle. This protocol already demands uniqueness, so the
 * context fields are empty — the find string carries the whole burden.
 *
 * Format-only edits have no OOXML equivalent here and are dropped by the
 * caller; they are an Office.js capability.
 */
export function toEditInput(edit: ProposedEdit): EditInput | null {
  if (typeof edit.replacement !== 'string') return null
  return {
    find: edit.original,
    replace: edit.replacement,
    context_before: '',
    context_after: '',
    reason: edit.reason || undefined,
  }
}
