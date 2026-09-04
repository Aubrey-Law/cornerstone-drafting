/**
 * Names that are not names.
 *
 * A fiduciary slot holding a contact called "To Be Determined" produces a
 * document that is *worse* than one with a visible blank. The generator has a
 * name, so it emits no `[[ MISSING: … ]]` marker; the draft preflight reports
 * the document clean; the share gate passes it; and a will reaches a client
 * naming "To Be Determined" as guardian of their minor children. A marker looks
 * obviously wrong. A placeholder looks deliberate.
 *
 * The firm's contact list holds one such row, used across fifteen fiduciary
 * slots in five roles, so this is not hypothetical.
 *
 * **The match is on the whole name, never a substring.** A real person named
 * "Tara Bandt" or "Anna Tba" must never be silently dropped from an instrument —
 * suppressing a genuine appointee is a far worse failure than letting a
 * placeholder through, and it would be invisible. Anything short of an exact
 * match is left alone.
 */

const PLACEHOLDER_NAMES = new Set([
  'to be determined',
  'to be decided',
  'to be named',
  'tbd',
  'tba',
  'unknown',
  'unnamed',
  'pending',
  'n/a',
  '???',
])

/** True when a name is a stand-in for a decision nobody has made yet. */
export function isPlaceholderName(name: string | null | undefined): boolean {
  if (!name) return false
  // Collapse internal whitespace so "To  Be Determined" reads the same, and
  // drop a trailing period so "T.B.D." and "TBD." match. Nothing else is
  // stripped: the comparison stays an exact one.
  const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '')
  if (PLACEHOLDER_NAMES.has(normalized)) return true
  return PLACEHOLDER_NAMES.has(normalized.replace(/\./g, ''))
}

/**
 * A contact's name, or null when it is a placeholder.
 *
 * Returning null puts a placeholder on exactly the same footing as an empty
 * slot, so every existing mechanism handles it without a parallel code path:
 * the generator emits its `[[ MISSING: … ]]` marker, the preflight reports the
 * field, `designTargetForMissingField` points at Fiduciary Role Assignment, and
 * the share gate refuses the document.
 */
export function realNameOrNull(name: string | null | undefined): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  return isPlaceholderName(trimmed) ? null : trimmed
}
