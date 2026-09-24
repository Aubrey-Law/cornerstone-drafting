import 'server-only'
import { IntegrationError } from '@/lib/integrations/errors'
import { lawmaticsRequest } from './client'
import { LAWMATICS_OPTION_KINDS, type LawmaticsOptionKind } from './pushFields'

export interface LawmaticsOption {
  id: string
  name: string
}

export type LawmaticsOptionList =
  | { ok: true; options: LawmaticsOption[] }
  | { ok: false; error: string }

const PATHS: Record<LawmaticsOptionKind, string> = {
  practice_area: '/v1/practice_areas',
  source: '/v1/sources',
  campaign: '/v1/campaigns',
}

const PER_PAGE = 100
// Lawmatics can cap per_page below what we ask for (older endpoints return 25),
// so a page shorter than PER_PAGE is not the end: keep going until a page is
// empty or brings nothing new.
const MAX_PAGES = 50

function option(row: unknown): LawmaticsOption | null {
  if (!row || typeof row !== 'object') return null
  const record = row as Record<string, unknown>
  const id = typeof record.id === 'string' || typeof record.id === 'number' ? String(record.id).trim() : ''
  const attributes = (record.attributes && typeof record.attributes === 'object' ? record.attributes : record) as Record<string, unknown>
  const name = [attributes.name, attributes.title, attributes.label].find(value => typeof value === 'string' && value.trim())
  return id && /^\d{1,12}$/.test(id) ? { id, name: typeof name === 'string' ? name.trim() : `#${id}` } : null
}

/** Reads one Lawmatics picklist, page by page until a page is empty or repeats. */
export async function listLawmaticsOptions(kind: LawmaticsOptionKind): Promise<LawmaticsOption[]> {
  const found = new Map<string, LawmaticsOption>()
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await lawmaticsRequest<unknown>(`${PATHS[kind]}?page=${page}&per_page=${PER_PAGE}`, { method: 'GET' })
    const rows = Array.isArray(data) ? data : []
    const before = found.size
    for (const row of rows) {
      const parsed = option(row)
      if (parsed) found.set(parsed.id, parsed)
    }
    if (rows.length === 0 || found.size === before) break
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Every picklist the push maps, each loaded independently so one failure doesn't hide the rest. */
export async function listAllLawmaticsOptions(): Promise<Record<LawmaticsOptionKind, LawmaticsOptionList>> {
  const entries = await Promise.all(LAWMATICS_OPTION_KINDS.map(async kind => {
    try {
      return [kind, { ok: true, options: await listLawmaticsOptions(kind) }] as const
    } catch (error) {
      const message = error instanceof IntegrationError ? error.safeMessage : 'The Lawmatics list could not be loaded.'
      return [kind, { ok: false, error: message }] as const
    }
  }))
  return Object.fromEntries(entries) as Record<LawmaticsOptionKind, LawmaticsOptionList>
}
