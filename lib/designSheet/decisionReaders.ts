/**
 * Readers shared by the `decisions.*` namespace modules.
 *
 * A design-sheet choice has three states, not two: decided one way, decided the
 * other, and not yet decided. `readBoolean(raw, key, false)` collapses the last
 * two, which is why the completion engine's `isFieldOpen` reads the raw blob
 * rather than a getter. For a choice field, keep the third state by defaulting
 * to null — and treat a stored value outside the allowed list as undecided too,
 * so a renamed or hand-edited option cannot smuggle a bogus enum downstream to
 * a template comparison that will silently never match.
 */

/** The stored value when it is one of `allowed`, otherwise null. */
export function readAllowedValue<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | null {
  const value = raw[key]
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null
}
