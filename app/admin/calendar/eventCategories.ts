import type { EventCategory, ExternalCalendarEvent } from './types'

export interface CategoryStyle {
  bg: string
  text: string
  dot: string
}

/**
 * Appointments carry a `typeLabel`; calendar events only ever have a subject,
 * so both are classified from their display text.
 */
export function categorize(label: string): EventCategory {
  const s = label.toLowerCase()
  if (/discovery/.test(s)) return 'discovery'
  if (/signing|execution/.test(s)) return 'signing'
  if (/draft|design|review/.test(s)) return 'draft'
  if (/client|peace of mind|planning session|estate plan/.test(s)) return 'meeting'
  return 'internal'
}

/** Stage tokens carry their own light/dark values, so these read in both themes. */
export const CATEGORY_STYLE: Record<EventCategory, CategoryStyle> = {
  discovery: { bg: 'var(--stage-early-bg)', text: 'var(--stage-early-text)', dot: 'var(--stage-early)' },
  meeting: { bg: 'var(--stage-work-bg)', text: 'var(--stage-work-text)', dot: 'var(--stage-work)' },
  draft: { bg: 'var(--stage-active-bg)', text: 'var(--stage-active-text)', dot: 'var(--stage-active)' },
  signing: { bg: 'var(--stage-done-bg)', text: 'var(--stage-done-text)', dot: 'var(--stage-done)' },
  internal: { bg: 'var(--stage-closed-bg)', text: 'var(--stage-closed-text)', dot: 'var(--stage-closed)' },
}

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  discovery: 'Discovery',
  meeting: 'Client meeting',
  draft: 'Draft / design review',
  signing: 'Signing',
  internal: 'Internal / calendar',
}

export const CATEGORY_LEGEND: { category: EventCategory; label: string }[] = [
  'discovery', 'meeting', 'draft', 'signing', 'internal',
].map(category => ({
  category: category as EventCategory,
  label: CATEGORY_LABEL[category as EventCategory],
}))

/** Diagonal hatch used for "block" holds, which are background, not events. */
export const BLOCK_HATCH =
  'repeating-linear-gradient(45deg, var(--page-bg) 0 3px, var(--page-bg-2) 3px 6px)'

/** Calendar holds named "BLOCK" are time the attorney reserved, not a meeting. */
export function isBlock(event: ExternalCalendarEvent): boolean {
  return /^\s*◦?\s*block/i.test(event.subject)
}

export function categoryStyleFor(label: string): CategoryStyle {
  return CATEGORY_STYLE[categorize(label)]
}
