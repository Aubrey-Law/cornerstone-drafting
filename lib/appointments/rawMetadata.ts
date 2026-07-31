export type RawMetadata = Record<string, unknown>

export function getRawMetadata(raw: unknown): RawMetadata | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as RawMetadata
}

export function getRawBoolean(raw: unknown, key: string, fallback: boolean): boolean {
  const metadata = getRawMetadata(raw)
  return typeof metadata?.[key] === 'boolean' ? (metadata[key] as boolean) : fallback
}

export function getRawString(raw: unknown, key: string): string | undefined {
  const metadata = getRawMetadata(raw)
  return typeof metadata?.[key] === 'string' ? (metadata[key] as string) : undefined
}
