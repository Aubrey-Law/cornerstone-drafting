/**
 * Turn what the design sheet still lacks into one checklist task on the matter.
 *
 * The readiness engine already knows what is open — it drives the Complete
 * sheet count and `read_design_sheet_status`. After a PMPS or a design meeting
 * that list is the follow-up list, but it lived only on the drafting page,
 * where somebody had to remember to look. This puts it in the task queue.
 *
 * One task per matter, not one per item: a meeting's leftovers are worked
 * through together (one email to the client, one pass at the sheet), and forty
 * single tasks would bury everything else on the matter. Running it again
 * refreshes that same task rather than adding a second one: items that have
 * since been answered are ticked, new gaps are appended, and anything the
 * attorney already ticked stays ticked.
 */
import type { DesignReadinessBlocker } from '@/lib/designSheetReadiness'
import type { ChecklistItem } from '@/lib/tasks/types'

/** Marks the task this module owns, so a re-run finds it instead of adding another. */
export const DESIGN_SHEET_FOLLOW_UP_BATCH_TAG = 'design-sheet-follow-up'

export const DESIGN_SHEET_FOLLOW_UP_TITLE = 'Design sheet follow-up: missing information'

/** Who has to act. Readiness categories say why an item is open; this says who closes it. */
const CATEGORY_PREFIX: Record<DesignReadinessBlocker['category'], string> = {
  'client-decision': 'Ask client',
  approval: 'Attorney sign-off',
  required: 'Needed',
}

/** The line a ticked-off list shows for one open item. */
export function followUpItemText(blocker: DesignReadinessBlocker): string {
  const optional = blocker.blocking ? '' : ' (optional)'
  return `${CATEGORY_PREFIX[blocker.category]} — ${blocker.sectionLabel}: ${blocker.label}${optional}`
}

/**
 * The open items worth a follow-up, in a stable order.
 *
 * Everything blocking generation, plus the optional items that only the client
 * can answer. The other optional items have firm defaults that produce a valid
 * document, so chasing them would turn a follow-up list into a questionnaire.
 */
export function followUpItems(
  blocking: DesignReadinessBlocker[],
  optional: DesignReadinessBlocker[],
): string[] {
  const order: Record<DesignReadinessBlocker['category'], number> = {
    'client-decision': 0,
    required: 1,
    approval: 2,
  }
  const chosen = [
    ...blocking,
    ...optional.filter(item => item.category === 'client-decision'),
  ]
  const sorted = chosen
    .map((item, index) => ({ item, index }))
    .sort((a, b) =>
      Number(b.item.blocking) - Number(a.item.blocking)
      || order[a.item.category] - order[b.item.category]
      || a.index - b.index,
    )
    .map(({ item }) => followUpItemText(item))
  return [...new Set(sorted)]
}

/**
 * Fold a fresh list into the task's existing checklist.
 *
 * An existing item no longer open has been answered on the sheet, so it is
 * ticked rather than removed — the task keeps its history of what was chased.
 * An existing item still open keeps whatever state the attorney gave it; a
 * tick there means "asked, waiting", and un-ticking it would erase that.
 */
export function mergeFollowUpChecklist(existing: ChecklistItem[], fresh: string[]): ChecklistItem[] {
  const open = new Set(fresh)
  const seen = new Set<string>()
  const merged: ChecklistItem[] = existing.map(item => {
    seen.add(item.text)
    return open.has(item.text) ? item : { ...item, done: true }
  })
  for (const text of fresh) {
    if (!seen.has(text)) merged.push({ text, done: false })
  }
  return merged
}

export function followUpDescription(blockingCount: number, itemCount: number): string {
  const blockingLine = blockingCount === 0
    ? 'Nothing is blocking document generation; the items below are client choices still open.'
    : `${blockingCount === 1 ? '1 item blocks' : `${blockingCount} items block`} document generation.`
  return [
    `What the design sheet still needs after the meeting — ${itemCount === 1 ? '1 item' : `${itemCount} items`}.`,
    blockingLine,
    '',
    '"Ask client" items go in the follow-up email. Once answered, record them on the design sheet',
    '(Complete sheet → Paste notes takes the client\'s reply as-is) and run Create follow-up task',
    'again: answered items tick themselves off.',
  ].join('\n')
}
