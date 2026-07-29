/**
 * Preserve omission on partial intake saves while still allowing an explicit
 * blank date to clear a previously saved value.
 */
export function optionalDateOrNull(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  return typeof value === 'string' && value.trim() ? value : null
}
