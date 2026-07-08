const JURISDICTION_STATE_ALIASES: Record<string, string> = {
  ma: 'MA',
  mass: 'MA',
  massachusetts: 'MA',
  'commonwealth of massachusetts': 'MA',
}

/** Normalize intake/design-sheet state values to a two-letter jurisdiction code. */
export function normalizeJurisdictionStateCode(
  value: string | null | undefined,
  fallback = 'MA',
): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return fallback

  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    return trimmed.toUpperCase()
  }

  return JURISDICTION_STATE_ALIASES[trimmed.toLowerCase()] ?? trimmed
}
