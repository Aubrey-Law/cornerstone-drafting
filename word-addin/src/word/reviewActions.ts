import { anchor, authorRevision, isSearchable } from './applyTrackedEdits'
import { serializeWordMutation } from './mutationQueue'

/**
 * Acting on a review finding in the open document.
 *
 * A finding carries a verified citation: the exact text it is about and the
 * index of the paragraph it came from, read from this document's own
 * `body.paragraphs` (see `readParagraphTexts`). Finding it again is still a
 * search — Word has no "go to offset" — but a search scoped to one paragraph,
 * which is what makes it reliable:
 *
 * - The paragraph is tried first, and only if it still contains the quote. The
 *   attorney may have edited since the review ran, which shifts indexes.
 * - Otherwise the whole body is searched, and only a single match is accepted.
 *   Picking the first of two would put a comment on the wrong clause.
 * - A quote longer than Word's 255-character search limit is found by its
 *   first and last stretches, then joined with `expandTo`.
 */

/** The paragraph text of the whole document, in `body.paragraphs` order, empty ones included. */
export async function readParagraphTexts(): Promise<string[]> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs
    paragraphs.load('items/text')
    await context.sync()
    return paragraphs.items.map((p) => p.text ?? '')
  })
}

export interface CitationTarget {
  /** Paragraph index in `body.paragraphs` when the review ran. */
  blockIndex: number
  /** The document's own text, as verified by the server. */
  quote: string
}

export type LocateFailure = 'not-found' | 'ambiguous' | 'unsearchable'

/** Chars of a long quote searched at each end; well inside the 255 limit. */
const EDGE_CHARS = 120

export type SearchPlan =
  | { kind: 'whole'; text: string }
  | { kind: 'edges'; head: string; tail: string }
  | { kind: 'unsearchable' }

/** How a quote can be searched for, given Word's limits. Pure, so it is tested directly. */
export function searchPlan(quote: string): SearchPlan {
  const text = quote.trim()
  if (!text || /[\r\n\v\f]/.test(text) || text.includes('^')) return { kind: 'unsearchable' }
  if (isSearchable(text)) return { kind: 'whole', text }
  const head = text.slice(0, EDGE_CHARS).trimEnd()
  const tail = text.slice(-EDGE_CHARS).trimStart()
  if (!isSearchable(head) || !isSearchable(tail)) return { kind: 'unsearchable' }
  return { kind: 'edges', head, tail }
}

async function searchUnique(
  context: Word.RequestContext,
  scope: Word.Body | Word.Paragraph,
  text: string,
): Promise<{ range: Word.Range | null; matches: number }> {
  const found = scope.search(text, { matchCase: true })
  found.load('items')
  await context.sync()
  return { range: found.items.length === 1 ? found.items[0] : null, matches: found.items.length }
}

async function locateIn(
  context: Word.RequestContext,
  scope: Word.Body | Word.Paragraph,
  plan: Exclude<SearchPlan, { kind: 'unsearchable' }>,
): Promise<{ range: Word.Range | null; failure: LocateFailure | null }> {
  if (plan.kind === 'whole') {
    const { range, matches } = await searchUnique(context, scope, plan.text)
    return { range, failure: range ? null : matches > 1 ? 'ambiguous' : 'not-found' }
  }
  const head = await searchUnique(context, scope, plan.head)
  const tail = await searchUnique(context, scope, plan.tail)
  if (!head.range || !tail.range) {
    return { range: null, failure: head.matches > 1 || tail.matches > 1 ? 'ambiguous' : 'not-found' }
  }
  return { range: head.range.expandTo(tail.range), failure: null }
}

/** Finds the cited passage, or says why it cannot. Runs inside the caller's `Word.run`. */
export async function locateCitation(
  context: Word.RequestContext,
  target: CitationTarget,
): Promise<{ range: Word.Range | null; failure: LocateFailure | null }> {
  const plan = searchPlan(target.quote)
  if (plan.kind === 'unsearchable') return { range: null, failure: 'unsearchable' }

  const paragraphs = context.document.body.paragraphs
  paragraphs.load('items/text')
  await context.sync()

  const paragraph = paragraphs.items[target.blockIndex]
  if (paragraph && (paragraph.text ?? '').includes(target.quote.trim())) {
    const scoped = await locateIn(context, paragraph, plan)
    if (scoped.range) return scoped
  }
  return locateIn(context, context.document.body, plan)
}

export type ActionResult = { ok: true; bookmark?: string } | { ok: false; reason: string }

export function describeLocateFailure(failure: LocateFailure): string {
  switch (failure) {
    case 'not-found':
      return 'That passage is no longer in the document — it may have been edited since the review ran.'
    case 'ambiguous':
      return 'That passage now appears more than once, so the pane cannot tell which one is meant.'
    case 'unsearchable':
      return 'Word cannot search for that passage (it contains a character Word search treats specially).'
  }
}

/** Selects the cited passage so Word scrolls to it. */
export async function revealCitation(target: CitationTarget): Promise<ActionResult> {
  return Word.run(async (context) => {
    try {
      const { range, failure } = await locateCitation(context, target)
      if (!range) return { ok: false as const, reason: describeLocateFailure(failure ?? 'not-found') }
      range.select()
      await context.sync()
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, reason: err instanceof Error ? err.message : 'Word could not select it.' }
    }
  })
}

/** Attaches the finding to the passage as a Word comment, where the attorney's normal review will see it. */
export async function commentOnCitation(target: CitationTarget, text: string): Promise<ActionResult> {
  return serializeWordMutation(() =>
    Word.run(async (context) => {
      try {
        const { range, failure } = await locateCitation(context, target)
        if (!range) return { ok: false as const, reason: describeLocateFailure(failure ?? 'not-found') }
        range.insertComment(text)
        await context.sync()
        return { ok: true as const }
      } catch (err) {
        return { ok: false as const, reason: err instanceof Error ? err.message : 'Word could not add the comment.' }
      }
    }),
  )
}

/**
 * Runs `author` with tracking forced on, and restores the attorney's own mode
 * afterwards whatever happens — the same discipline as `applyTrackedEdits`.
 */
async function tracked<T>(context: Word.RequestContext, author: () => Promise<T>): Promise<T> {
  const doc = context.document
  doc.load('changeTrackingMode')
  await context.sync()
  const originalMode = doc.changeTrackingMode
  // Synced alone: batched with the edit, the edit can land untracked.
  doc.changeTrackingMode = Word.ChangeTrackingMode.trackAll
  await context.sync()
  try {
    return await author()
  } finally {
    doc.changeTrackingMode = originalMode
    await context.sync()
  }
}

/** Replaces the cited passage with the finding's proposed language, as a tracked change. */
export async function replaceCitationTracked(target: CitationTarget, replacement: string): Promise<ActionResult> {
  return serializeWordMutation(() =>
    Word.run(async (context) => {
      try {
        const { range, failure } = await locateCitation(context, target)
        if (!range) return { ok: false as const, reason: describeLocateFailure(failure ?? 'not-found') }

        // Never author over someone else's revision: rejecting ours would then
        // reject theirs too.
        const existing = range.getTrackedChanges()
        existing.load('items')
        await context.sync()
        if (existing.items.length > 0) {
          return { ok: false as const, reason: 'That passage already carries a tracked change. Resolve it first.' }
        }

        const { bookmark } = await tracked(context, () =>
          authorRevision(context, range, { original: target.quote, replacement, reason: '' }),
        )
        return { ok: true as const, bookmark }
      } catch (err) {
        return { ok: false as const, reason: err instanceof Error ? err.message : 'Word rejected the change.' }
      }
    }),
  )
}

/**
 * Inserts the firm's language as a new paragraph after the one holding the
 * cursor, as a tracked change — for a finding that something is absent, where
 * there is no passage to replace and the attorney chooses where it goes.
 */
export async function insertAfterCursorTracked(text: string): Promise<ActionResult> {
  return serializeWordMutation(() =>
    Word.run(async (context) => {
      try {
        const paragraph = context.document.getSelection().paragraphs.getLast()
        const bookmark = await tracked(context, async () => {
          const inserted = paragraph.insertParagraph(text, Word.InsertLocation.after)
          await context.sync()
          return anchor(context, inserted.getRange())
        })
        return { ok: true as const, bookmark }
      } catch (err) {
        return { ok: false as const, reason: err instanceof Error ? err.message : 'Word could not insert it.' }
      }
    }),
  )
}
