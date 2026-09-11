/**
 * When a matter counts as closed.
 *
 * A matter can be closed along either of two axes, and the firm uses both: the
 * Close-out card moves the *stage* to `closed` (and stamps the closed date),
 * while the details card's Matter status sets `closed` or `archived` without
 * touching the stage. Reading only one of them is how a matter that had plainly
 * been closed kept its place in the working lists.
 *
 * Mirrored in SQL by `firm_matter_page_v1` and `drafting_hub_page` — see
 * supabase/migrations/20261128000000_hide_closed_matters.sql — because the
 * lists page in the database and must hide the same rows this hides.
 */
export const CLOSED_MATTER_STATUSES = ['closed', 'archived'] as const

export function isClosedMatter(matter: {
  status?: string | null
  stage?: string | null
}): boolean {
  return (
    (CLOSED_MATTER_STATUSES as readonly string[]).includes(matter.status ?? '')
    || matter.stage === 'closed'
  )
}
