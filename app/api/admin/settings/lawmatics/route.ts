import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getIntegrationSettings, updateIntegrationSettings } from '@/lib/integrations/settings'
import { LAWMATICS_PUSH_FIELDS, normalizeLawmaticsCustomFieldId } from '@/lib/integrations/lawmatics/pushFields'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAPPABLE_KEYS = new Set(LAWMATICS_PUSH_FIELDS.filter(field => !field.standard).map(field => field.key as string))
const MAX_ID_LENGTH = 100

/** GET /api/admin/settings/lawmatics — the Push to Lawmatics custom field mapping. */
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err
  try {
    const settings = await getIntegrationSettings()
    return NextResponse.json({ customFieldIdMap: settings.lawmaticsCustomFieldIdMap })
  } catch {
    return NextResponse.json({ error: 'Lawmatics settings could not be read' }, { status: 500 })
  }
}

/**
 * PUT /api/admin/settings/lawmatics { customFieldIdMap } — replaces the whole
 * mapping. Blank IDs clear a field; only Cornerstone's custom push keys are accepted.
 */
export async function PUT(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => null) as { customFieldIdMap?: unknown } | null
  const input = body?.customFieldIdMap
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return NextResponse.json({ error: 'customFieldIdMap must be an object' }, { status: 400 })
  }

  const map: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!MAPPABLE_KEYS.has(key)) {
      return NextResponse.json({ error: `Unknown Lawmatics field: ${key}` }, { status: 400 })
    }
    if (value === null || value === undefined) continue
    if (typeof value !== 'string') {
      return NextResponse.json({ error: 'Lawmatics custom field IDs must be text' }, { status: 400 })
    }
    if (!value.trim()) continue
    const id = value.length <= MAX_ID_LENGTH ? normalizeLawmaticsCustomFieldId(value) : null
    if (!id) {
      const label = LAWMATICS_PUSH_FIELDS.find(field => field.key === key)?.label ?? key
      return NextResponse.json({
        error: `${label}: "${value.trim().slice(0, 40)}" is not a Lawmatics custom field ID. Use the number from its merge field, e.g. 930886 from {{custom_field_930886}}.`,
      }, { status: 400 })
    }
    map[key] = id
  }

  try {
    await updateIntegrationSettings({ lawmaticsCustomFieldIdMap: map }, userId ?? null)
  } catch {
    return NextResponse.json({ error: 'Lawmatics settings could not be saved' }, { status: 500 })
  }
  return NextResponse.json({ customFieldIdMap: map })
}
