export type PageRequest = { page: number; pageSize: number }
export type PageResult<T> = PageRequest & { rows: T[]; total: number }

export function pageRequest(input: { page?: unknown; pageSize?: unknown } = {}): PageRequest {
  const page = Number(input.page ?? 1)
  const pageSize = Number(input.pageSize ?? 50)
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new Error('Page and page size must be positive integers')
  }
  if (page > 1_000_000) throw new Error('Page is out of range')
  return { page, pageSize: Math.min(pageSize, 100) }
}

/** Date-only half-open month bounds; no UTC conversion changes the accounting period. */
export function monthRange(month: string): { from: string; to: string } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month)
  if (!match || Number(match[1]) < 1000 || Number(match[1]) > 9998) throw new Error('Invalid month')
  const year = Number(match[1]), number = Number(match[2])
  return { from: `${month}-01`, to: number === 12 ? `${year+1}-01-01` : `${year}-${String(number+1).padStart(2,'0')}-01` }
}
