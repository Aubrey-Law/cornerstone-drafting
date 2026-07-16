function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getPath(data: unknown, dottedPath: string): unknown {
  let current: unknown = data

  for (const rawPart of dottedPath.split('.')) {
    const part = rawPart.endsWith('[]') ? rawPart.slice(0, -2) : rawPart

    if (Array.isArray(current)) {
      if (current.length === 0) return null
      current = current.map(item => isRecord(item) ? item[part] ?? null : null)
      continue
    }

    if (!isRecord(current) || !(part in current)) return null
    current = current[part]
  }

  return current
}

export function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

export function missingRequiredFields(data: Record<string, unknown>, requiredFields: readonly string[]): string[] {
  return requiredFields.filter(field => !isPresent(getPath(data, field)))
}
