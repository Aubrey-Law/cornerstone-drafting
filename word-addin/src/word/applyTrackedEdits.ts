import type { ProposedEdit } from './editTypes'
import { serializeWordMutation } from './mutationQueue'
import { stripStructuralMarkers } from './readDocument'

/**
 * Apply model-proposed edits to the open document as Word tracked changes.
 *
 * The whole design turns on one constraint: Word gives an add-in no way to say
 * "change the text at position N". The only handle is `search()`, so every edit
 * has to name a passage that exists verbatim and exactly once. Everything below
 * is either locating that passage or being honest about failing to.
 */

export type EditStatus = 'applied' | 'not-found' | 'ambiguous' | 'skipped' | 'error'

export interface EditOutcome {
  index: number
  status: EditStatus
  /** How many passages matched. Populated for `ambiguous`. */
  matches?: number
  /** Machine-readable cause for `skipped`; a message for `error`. */
  detail?: string
  /** Bookmark naming the changed passage, so the card survives a re-render. */
  bookmark?: string
  /**
   * True when Word reported an insertion but no matching deletion. Word for Mac
   * under-reports Deleted revisions (office-js#5188); the change is really there
   * and reviewable from Word's own Review tab, so this is a note, not a failure.
   */
  deletedRevisionMissing?: boolean
}

/** Word's search rejects anything past this; the prompt caps `original` at 200. */
const MAX_SEARCH_CHARS = 255

/**
 * Can Word's search engine even look for this string?
 *
 * Checked before calling Word so a bad edit becomes one reported card rather
 * than an exception that aborts every remaining edit in the batch.
 */
export function isSearchable(text: string): boolean {
  if (!text || text.length > MAX_SEARCH_CHARS) return false
  // search() matches within a paragraph, so an embedded break can never hit.
  if (/[\r\n\v\f]/.test(text)) return false
  // '^' leads an escape sequence in Word's search syntax even with wildcards off.
  if (text.includes('^')) return false
  return true
}

/**
 * Models emit typographic punctuation where the document has ASCII, or the
 * reverse — the single most common cause of a `not-found` on text the attorney
 * can plainly see. Tried as a second pass, never as the first.
 */
export function normalizeTypography(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
}

export async function applyTrackedEdits(edits: ProposedEdit[]): Promise<EditOutcome[]> {
  if (!Office.context.requirements.isSetSupported('WordApi', '1.6')) {
    return edits.map((_, index) => ({
      index,
      status: 'skipped' as const,
      detail: 'This build of Word cannot review tracked changes (needs WordApi 1.6).',
    }))
  }

  return serializeWordMutation(() =>
    Word.run(async (context) => {
      const doc = context.document
      doc.load('changeTrackingMode')
      await context.sync()
      const originalMode = doc.changeTrackingMode

      // Sync the mode change on its own. Batched with the first insertion, that
      // insertion can land under the attorney's previous mode — untracked.
      doc.changeTrackingMode = Word.ChangeTrackingMode.trackAll
      await context.sync()

      const outcomes: EditOutcome[] = []
      try {
        for (const [index, edit] of edits.entries()) {
          outcomes.push(await applyOne(context, edit, index))
        }
      } finally {
        // Restore even on throw. Leaving trackAll on silently changes how the
        // attorney's own typing behaves for the rest of the session.
        doc.changeTrackingMode = originalMode
        await context.sync()
      }
      return outcomes
    }),
  )
}

async function applyOne(
  context: Word.RequestContext,
  edit: ProposedEdit,
  index: number,
): Promise<EditOutcome> {
  if (!isSearchable(edit.original)) {
    return {
      index,
      status: 'skipped',
      detail: 'unsearchable: too long, spans a paragraph break, or contains "^"',
    }
  }

  try {
    const body = context.document.body
    const found = await locate(context, body, edit.original)
    if (found.items.length === 0) return { index, status: 'not-found', matches: 0 }

    const replaceAll = edit.occurrence === 'all'
    if (found.items.length > 1 && !replaceAll) {
      return {
        index,
        status: 'ambiguous',
        matches: found.items.length,
        detail: `${found.items.length} passages match; the edit must name a unique one.`,
      }
    }

    // Replace-all takes the LAST match first. Word for the web mis-tracks later
    // matches once an earlier one changes length within the same batch
    // (office-js#2800), and working backwards keeps every remaining target's
    // position valid.
    const targets = replaceAll ? [...found.items].reverse() : [found.items[0]]

    let bookmark: string | undefined
    let sawDeletion = false

    for (const target of targets) {
      // Never author over an existing revision: accept/reject on this card
      // would then resolve somebody else's tracked change.
      const existing = target.getTrackedChanges()
      existing.load('items')
      await context.sync()
      if (existing.items.length > 0) {
        return { index, status: 'skipped', detail: 'pre-existing-revisions' }
      }

      const result = await authorRevision(context, target, edit)
      sawDeletion ||= result.sawDeletion
      bookmark ??= result.bookmark
    }

    return {
      index,
      status: 'applied',
      matches: targets.length,
      bookmark,
      deletedRevisionMissing: !sawDeletion,
    }
  } catch (err) {
    return {
      index,
      status: 'error',
      detail: err instanceof Error ? err.message : 'Word rejected the edit.',
    }
  }
}

/**
 * Find the passage, retrying once with the markers `readDocument` adds and once
 * with punctuation normalized. Both retries adopt whichever spelling actually
 * hit, so the revision that gets authored matches what was located.
 */
async function locate(
  context: Word.RequestContext,
  body: Word.Body,
  original: string,
): Promise<Word.RangeCollection> {
  const options: Word.SearchOptions | { matchCase: boolean } = { matchCase: true }

  let matches = body.search(original, options)
  matches.load('items')
  await context.sync()
  if (matches.items.length > 0) return matches

  for (const candidate of [stripStructuralMarkers(original), normalizeTypography(original)]) {
    if (candidate === original || !isSearchable(candidate)) continue
    const retry = body.search(candidate, options)
    retry.load('items')
    await context.sync()
    if (retry.items.length > 0) return retry
  }

  return matches
}

async function authorRevision(
  context: Word.RequestContext,
  target: Word.Range,
  edit: ProposedEdit,
): Promise<{ bookmark: string | undefined; sawDeletion: boolean }> {
  // A format-only edit restyles in place; under trackAll that is a Formatted
  // revision, with nothing deleted.
  if (edit.formats?.length) {
    applyFormats(target, edit.formats)
    await context.sync()
    return { bookmark: await anchor(context, target), sawDeletion: true }
  }

  const replacement = edit.replacement ?? ''

  // Insert-after then delete — NEVER insertText(..., Replace).
  //
  // Word for Mac decomposes a tracked Replace into an *untracked* deletion plus
  // a tracked insertion. The attorney's text disappears with no Deleted
  // revision to reject, and the bug is invisible on Windows. This two-step form
  // is the only one every host records as a reviewable pair.
  const inserted = replacement.length > 0
    ? target.insertText(replacement, Word.InsertLocation.after)
    : null
  target.delete()
  await context.sync()

  const scope = inserted ?? target
  const changes = scope.getTrackedChanges()
  changes.load('items/type')
  await context.sync()

  const sawDeletion = changes.items.some(c => c.type === 'Deleted')
  return { bookmark: await anchor(context, scope), sawDeletion }
}

function applyFormats(range: Word.Range, formats: string[]): void {
  for (const format of formats) {
    switch (format) {
      case 'bold':
        range.font.bold = true
        break
      case 'italic':
        range.font.italic = true
        break
      case 'underline':
        range.font.underline = Word.UnderlineType.single
        break
      case 'heading1':
        range.paragraphs.getFirst().styleBuiltIn = Word.BuiltInStyleName.heading1
        break
      case 'heading2':
        range.paragraphs.getFirst().styleBuiltIn = Word.BuiltInStyleName.heading2
        break
      case 'heading3':
        range.paragraphs.getFirst().styleBuiltIn = Word.BuiltInStyleName.heading3
        break
    }
  }
}

/**
 * Mark the changed passage with a hidden bookmark.
 *
 * Word proxies go stale the moment they leave their `Word.run`, so a card
 * cannot hold onto a Range across a React render. A bookmark is a durable,
 * cheap handle that survives reloads; the leading underscore keeps it out of
 * Word's own bookmark list, and the name stays inside Word's 40-character
 * alphanumeric limit.
 */
async function anchor(context: Word.RequestContext, range: Word.Range): Promise<string | undefined> {
  try {
    const name = `_csEdit${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
    range.insertBookmark(name)
    await context.sync()
    return name
  } catch {
    // Bookmarks are a convenience; an edit without one still applied, it just
    // cannot be scrolled to later.
    return undefined
  }
}
