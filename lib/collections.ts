export function normalizeSearchText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : ''
}
export function compareNullable<T>(
  left: T | null | undefined,
  right: T | null | undefined,
  compare: (a: T, b: T) => number,
): number {
  if (left == null && right == null) return 0
  if (left == null) return 1
  if (right == null) return -1
  return compare(left, right)
}

export function timestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

export function stableSort<T>(values: readonly T[], compare: (left: T, right: T) => number): T[] {
  return values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => compare(left.value, right.value) || left.index - right.index)
    .map(({ value }) => value)
}
