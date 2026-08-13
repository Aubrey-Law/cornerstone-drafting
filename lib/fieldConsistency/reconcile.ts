export interface FieldConsistencyRow {
  matterId: string
  field: string
  sourceValue: unknown
  designValue: unknown
  hasOverride: boolean
}

interface ReconcileInput {
  matterId: string
  sources: Record<string, unknown>
  design: Record<string, unknown>
  overrides?: Record<string, unknown> | null
  includeOverrides?: boolean
}

function comparable(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ').toLowerCase()
  return JSON.stringify(value)
}

export function reconcileFieldValues(input: ReconcileInput): FieldConsistencyRow[] {
  const fields = new Set([...Object.keys(input.sources), ...Object.keys(input.design)])
  const rows: FieldConsistencyRow[] = []
  for (const field of fields) {
    const sourceValue = input.sources[field] ?? null
    const designValue = input.design[field] ?? null
    if (comparable(sourceValue) === comparable(designValue)) continue
    const hasOverride = Boolean(input.overrides?.[field])
    if (hasOverride && !input.includeOverrides) continue
    rows.push({ matterId: input.matterId, field, sourceValue, designValue, hasOverride })
  }
  return rows.sort((a, b) => a.field.localeCompare(b.field))
}
