import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getIntegrationSettings, updateIntegrationSettings } from '@/lib/integrations/settings'
import {
  LAWMATICS_OPTION_KINDS, LAWMATICS_PUSH_FIELDS, leadSourceKey, normalizeLawmaticsCustomFieldId,
  type LawmaticsOptionIdMap,
} from '@/lib/integrations/lawmatics/pushFields'
import { PRACTICE_AREA_OPTIONS } from '@/lib/practiceArea'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAPPABLE_KEYS = new Set(LAWMATICS_PUSH_FIELDS.filter(field => !field.standard).map(field => field.key as string))
const PRACTICE_AREA_KEYS = new Set<string>(PRACTICE_AREA_OPTIONS.map(option => option.value))
const MAX_ID_LENGTH = 100
const MAX_LEAD_SOURCE_ROWS = 10_000

type LeadSource = { key: string; label: string; count: number }

/** Distinct lead sources in use, keyed the way the push looks them up, most common first. */
async function leadSources(): Promise<LeadSource[]> {
  const { data, error } = await getAdminClient().from('client_intake')
    .select('lead_source').not('lead_source', 'is', null).limit(MAX_LEAD_SOURCE_ROWS)
  if (error) throw new Error('Lead sources could not be read')
  const byKey = new Map<string, { labels: Map<string, number>; count: number }>()
  for (const row of (data ?? []) as { lead_source: string | null }[]) {
    const key = leadSourceKey(row.lead_source)
    if (!key) continue
    const entry = byKey.get(key) ?? { labels: new Map(), count: 0 }
    const label = row.lead_source!.trim().replace(/\s+/g, ' ')
    entry.labels.set(label, (entry.labels.get(label) ?? 0) + 1)
    entry.count++
    byKey.set(key, entry)
  }
  return [...byKey.entries()].map(([key, entry]) => ({
    key,
    label: [...entry.labels.entries()].sort((a, b) => b[1] - a[1])[0][0],
    count: entry.count,
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/** GET /api/admin/settings/lawmatics — the Push to Lawmatics field and picklist mappings. */
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err
  try {
    const [settings, sources] = await Promise.all([getIntegrationSettings(), leadSources()])
    return NextResponse.json({
      customFieldIdMap: settings.lawmaticsCustomFieldIdMap,
      optionIdMap: settings.lawmaticsOptionIdMap,
      leadSources: sources,
    })
  } catch {
    return NextResponse.json({ error: 'Lawmatics settings could not be read' }, { status: 500 })
  }
}

type Parsed<T> = { value: T } | { error: string }

function parseCustomFieldIdMap(input: unknown): Parsed<Record<string, string>> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'customFieldIdMap must be an object' }
  const map: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!MAPPABLE_KEYS.has(key)) return { error: `Unknown Lawmatics field: ${key}` }
    if (value === null || value === undefined) continue
    if (typeof value !== 'string') return { error: 'Lawmatics custom field IDs must be text' }
    if (!value.trim()) continue
    const id = value.length <= MAX_ID_LENGTH ? normalizeLawmaticsCustomFieldId(value) : null
    if (!id) {
      const label = LAWMATICS_PUSH_FIELDS.find(field => field.key === key)?.label ?? key
      return {
        error: `${label}: "${value.trim().slice(0, 40)}" is not a Lawmatics custom field ID. Use the number from its merge field, e.g. 930886 from {{custom_field_930886}}.`,
      }
    }
    map[key] = id
  }
  return { value: map }
}

function parseOptionIdMap(input: unknown): Parsed<LawmaticsOptionIdMap> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'optionIdMap must be an object' }
  const result: LawmaticsOptionIdMap = { practice_area: {}, source: {}, campaign: {} }
  for (const [kind, entries] of Object.entries(input)) {
    if (!(LAWMATICS_OPTION_KINDS as readonly string[]).includes(kind)) return { error: `Unknown Lawmatics picklist: ${kind}` }
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return { error: `${kind} must be an object` }
    for (const [rawKey, value] of Object.entries(entries)) {
      const key = kind === 'practice_area' ? rawKey : leadSourceKey(rawKey)
      if (!key || (kind === 'practice_area' && !PRACTICE_AREA_KEYS.has(key))) return { error: `Unknown ${kind} value: ${rawKey.slice(0, 40)}` }
      if (value === null || value === undefined || value === '') continue
      if (typeof value !== 'string' || !/^\d{1,12}$/.test(value.trim())) {
        return { error: `The Lawmatics ${kind.replace('_', ' ')} ID for "${rawKey.slice(0, 40)}" must be a number` }
      }
      result[kind as keyof LawmaticsOptionIdMap][key] = value.trim()
    }
  }
  return { value: result }
}

/**
 * PUT /api/admin/settings/lawmatics { customFieldIdMap?, optionIdMap? } —
 * replaces whichever mappings are supplied. Blank IDs clear an entry.
 */
export async function PUT(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => null) as { customFieldIdMap?: unknown; optionIdMap?: unknown } | null
  if (!body || (body.customFieldIdMap === undefined && body.optionIdMap === undefined)) {
    return NextResponse.json({ error: 'Provide customFieldIdMap or optionIdMap' }, { status: 400 })
  }

  const patch: { lawmaticsCustomFieldIdMap?: Record<string, string>; lawmaticsOptionIdMap?: LawmaticsOptionIdMap } = {}
  if (body.customFieldIdMap !== undefined) {
    const parsed = parseCustomFieldIdMap(body.customFieldIdMap)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    patch.lawmaticsCustomFieldIdMap = parsed.value
  }
  if (body.optionIdMap !== undefined) {
    const parsed = parseOptionIdMap(body.optionIdMap)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    patch.lawmaticsOptionIdMap = parsed.value
  }

  try {
    await updateIntegrationSettings(patch, userId ?? null)
    const settings = await getIntegrationSettings()
    return NextResponse.json({
      customFieldIdMap: settings.lawmaticsCustomFieldIdMap,
      optionIdMap: settings.lawmaticsOptionIdMap,
    })
  } catch {
    return NextResponse.json({ error: 'Lawmatics settings could not be saved' }, { status: 500 })
  }
}
