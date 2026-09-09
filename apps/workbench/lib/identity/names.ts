/**
 * Comparing the name a matter is filed under with the name its design sheet
 * drafts for.
 *
 * Every rule here exists because the simpler rule flagged a real person
 * wrongly, measured across all 39 matters that had both on 2026-09-09. The
 * cases are in tests/name-agreement.test.ts by the name that falsified them.
 *
 * Deliberately no database and no Supabase types: this is a string question,
 * and keeping it pure is what lets the awkward cases be tested by name rather
 * than by fixture.
 */

/** Suffixes that say nothing about who someone is. */
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v', 'md', 'esq', 'phd'])

/**
 * The person a matter is named for.
 *
 * Matter names are `<person> — <what the matter is>`: "Can Cheng — Estate
 * Planning". Most carry no separator at all, and those are already just a name.
 * Em dash, en dash and hyphen all appear in the data.
 */
export function personPartOf(matterName: string | null | undefined): string | null {
  if (!matterName) return null
  const [first] = matterName.replace(/[—–]/g, '-').split('-')
  const trimmed = first.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * A name as comparable tokens: lowercased, punctuation dropped, suffixes
 * removed. Hyphens survive, because a hyphenated surname is one surname.
 */
export function normaliseName(name: string | null | undefined): string[] {
  if (!name) return []
  return name
    .toLowerCase()
    .replace(/[^a-z\s-]/g, '')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !SUFFIXES.has(token))
}

/** Whether one surname is a hyphen-delimited component of the other. */
function surnamesAgree(a: string, b: string): boolean {
  if (a === b) return true
  // Only a whole component counts, never a substring. "Ann" would agree with
  // "Annette" under a substring rule, and they are different surnames.
  //
  // No matter in the practice distinguishes the two rules today — checked
  // 2026-09-09 across every matter with both names, and none has one surname
  // as a non-component substring of the other. So unlike every other rule in
  // this file, this one is prophylactic rather than measured, and its test
  // says so. An earlier draft of this comment offered "Ann" and "Anderson" as
  // the example, which is simply wrong: Anderson contains "and", not "ann",
  // so that pair agrees under neither rule and proved nothing.
  return a.split('-').includes(b) || b.split('-').includes(a)
}

/**
 * Whether two names plausibly name one person.
 *
 * First token and surname, and nothing in between — a middle name or initial
 * appears on one record and not the other constantly, and is never the
 * discrepancy worth an attorney's time.
 */
export function namesAgree(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normaliseName(a)
  const right = normaliseName(b)
  if (left.length === 0 || right.length === 0) return false
  if (left[0] !== right[0]) return false
  return surnamesAgree(left[left.length - 1], right[right.length - 1])
}
