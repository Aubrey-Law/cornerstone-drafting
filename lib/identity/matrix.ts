import { namesAgree, personPartOf } from './names'

/**
 * One matter's name disagreeing with the sheet it drafts from.
 *
 * Found 2026-09-09: a matter filed as "Can Cheng — Estate Planning" whose
 * sheet drafts for "Jie Cheng", with the sheet's own `concerns` field calling
 * it an unresolved identity discrepancy. A document generated from
 * `client_name` would carry the wrong name, and nothing noticed. The
 * design-sheet audit cannot notice: "these two names may be one person" is not
 * one of check 2's outcomes, and two runs answered it two different ways.
 *
 * One kind, one severity. Unlike `lib/fiduciary/matrix.ts`, which grades
 * `error`/`gap`/`note` and drops `note` before it becomes a task, every issue
 * here is worth the same attention — the owner's ruling, 2026-09-09 — so there
 * is no severity field and no map with a single key.
 */
export interface IdentityIssue {
  matterId: string
  kind: 'name_disagreement'
  /** The person the matter is filed under. */
  matterPerson: string
  sheetClientName: string
  sheetSpouseName: string | null
}

export interface NameCandidateMatter {
  id: string
  name: string | null
}

export interface NameCandidateSheet {
  clientName: string | null
  spouseName: string | null
}

/**
 * The issue for one matter, or null.
 *
 * Agreeing with *either* the client or the spouse is agreement: a couples
 * matter named for one spouse is ordinary, and the measurement found one.
 *
 * Nothing to compare returns null rather than an issue. A matter with no
 * usable name, or a sheet with no client name, says nothing either way, and
 * reporting it would put a task on every half-filled sheet in the practice —
 * twelve of nineteen `client_review` sheets have an empty `concerns` field
 * alone, so incompleteness is normal here and is not this checker's subject.
 */
export function nameIssueFor(
  matter: NameCandidateMatter,
  sheet: NameCandidateSheet,
): IdentityIssue | null {
  const matterPerson = personPartOf(matter.name)
  const clientName = sheet.clientName?.trim() ?? ''
  if (!matterPerson || clientName.length === 0) return null

  if (namesAgree(matterPerson, clientName)) return null
  if (namesAgree(matterPerson, sheet.spouseName)) return null

  return {
    matterId: matter.id,
    kind: 'name_disagreement',
    matterPerson,
    sheetClientName: clientName,
    sheetSpouseName: sheet.spouseName?.trim() || null,
  }
}
