export const ACTIVITY_PAGE_SIZE = 50
export const ACTIVITY_SOURCES = ['matter', 'lead', 'crm', 'drafting', 'review', 'scan'] as const
export interface ActivityRow {
  id: string
  source: string
  occurred_at: string
  event_type: string
  summary: string
  actor_id: string | null
  actor_name: string | null
  matter_id: string | null
  lead_id: string | null
  person_id: string | null
  person_ids: string[]
  record_name: string | null
  href: string
  status: string | null
}
export type ActivityFilters = { source: string; record: string; person: string; actor: string; event: string; from: string; to: string; cursor: { at: string; id: string } | null }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function activityFilters(params: Record<string, string | string[] | undefined>): ActivityFilters {
  const get = (key: string) => typeof params[key] === 'string' ? params[key] as string : ''
  const source = get('source')
  if (source && !(ACTIVITY_SOURCES as readonly string[]).includes(source)) throw new Error('Invalid activity source')
  for (const key of ['record', 'person', 'actor']) if (get(key) && !UUID.test(get(key))) throw new Error(`Invalid ${key} ID`)
  const event = get('event')
  if (event && !/^[a-zA-Z0-9_.:-]{1,100}$/.test(event)) throw new Error('Invalid event type')
  for (const key of ['from', 'to']) if (get(key) && (!/^\d{4}-\d{2}-\d{2}$/.test(get(key)) || Number.isNaN(Date.parse(get(key))) || new Date(get(key)).toISOString().slice(0, 10) !== get(key))) throw new Error('Invalid date')
  if (get('from') && get('to') && get('from') > get('to')) throw new Error('Start date must precede end date')
  let cursor: ActivityFilters['cursor'] = null
  if (get('cursor')) {
    try {
      const parsed = JSON.parse(Buffer.from(get('cursor'), 'base64url').toString())
      if (typeof parsed.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(parsed.at) || Number.isNaN(Date.parse(parsed.at)) || typeof parsed.id !== 'string') throw new Error()
      const [prefix, id, extra] = parsed.id.split(':')
      if (extra || !(ACTIVITY_SOURCES as readonly string[]).includes(prefix) || !UUID.test(id)) throw new Error()
      cursor = { at: parsed.at, id: parsed.id }
    } catch { throw new Error('Invalid activity cursor') }
  }
  return { source, record: get('record'), person: get('person'), actor: get('actor'), event, from: get('from'), to: get('to'), cursor }
}
export function activityCursor(row: Pick<ActivityRow, 'occurred_at' | 'id'>) {
  // Preserve PostgreSQL microseconds; Date.toISOString would round them away.
  return Buffer.from(JSON.stringify({ at: row.occurred_at, id: row.id })).toString('base64url')
}
