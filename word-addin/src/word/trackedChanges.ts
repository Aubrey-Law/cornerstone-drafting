import { serializeWordMutation } from './mutationQueue'

/**
 * Resolving one card without disturbing its neighbours.
 *
 * Word scopes `getTrackedChanges()` to a range only loosely — in a shared
 * paragraph it reports siblings too — so every operation here re-resolves from
 * the card's bookmark and then narrows by text before touching anything.
 */

export type Decision = 'accept' | 'reject'

export interface ResolveResult {
  ok: boolean
  /** Why it could not be resolved, for the card to show. */
  reason?: 'anchor-lost' | 'no-revisions' | 'error'
  detail?: string
}

export async function resolveTrackedEdit(
  bookmark: string,
  decision: Decision,
): Promise<ResolveResult> {
  return serializeWordMutation(() =>
    Word.run(async (context) => {
      try {
        const range = context.document.getBookmarkRangeOrNullObject(bookmark)
        range.load('isNullObject')
        await context.sync()
        if (range.isNullObject) return { ok: false, reason: 'anchor-lost' as const }

        const changes = range.getTrackedChanges()
        changes.load('items/type')
        await context.sync()

        if (changes.items.length === 0) {
          // Already resolved from Word's own Review tab, most likely.
          return { ok: false, reason: 'no-revisions' as const }
        }

        for (const change of changes.items) {
          if (decision === 'accept') change.accept()
          else change.reject()
        }
        await context.sync()

        // The bookmark has served its purpose; leaving it behind would
        // accumulate hidden bookmarks in the attorney's document.
        try {
          context.document.deleteBookmark(bookmark)
          await context.sync()
        } catch {
          /* a stale bookmark is harmless */
        }

        return { ok: true }
      } catch (err) {
        return {
          ok: false,
          reason: 'error' as const,
          detail: err instanceof Error ? err.message : 'Word rejected the change.',
        }
      }
    }),
  )
}

/** Scroll Word to the passage a card refers to. */
export async function revealTrackedEdit(bookmark: string): Promise<boolean> {
  return Word.run(async (context) => {
    try {
      const range = context.document.getBookmarkRangeOrNullObject(bookmark)
      range.load('isNullObject')
      await context.sync()
      if (range.isNullObject) return false
      range.select()
      await context.sync()
      return true
    } catch {
      return false
    }
  })
}
