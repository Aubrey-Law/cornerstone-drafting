/** Parse design-sheet updated_at values from either JS ISO or Postgres timestamptz strings. */
export function parseUpdatedAt(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/** Compare timestamps without relying on exact string equality across storage layers. */
export function updatedAtMatches(
  expected: string | null | undefined,
  current: string | null | undefined,
): boolean {
  if (!expected || !current) return expected === current
  if (expected === current) return true
  const expectedMs = parseUpdatedAt(expected)
  const currentMs = parseUpdatedAt(current)
  if (expectedMs == null || currentMs == null) return false
  return expectedMs === currentMs
}
