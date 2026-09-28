import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { saveScanDisposition, SCAN_DISPOSITIONS, type ScanDisposition } from '@/lib/review/scans'
import type { GeneratedDatabase } from '@/types/supabase'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_KEY = 200
const MAX_NOTE = 2_000

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/**
 * A decision made in Word on an issue-spotting or proofreading item, saved to
 * the check's review history (`lib/review/scans.ts`).
 *
 * The pane names the item by the id it streamed under, since it never sees row
 * ids. An item not saved yet — its section still being written, or saving
 * stopped part-way — answers 404, and the pane says the decision is kept only
 * in Word.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const userId = auth.userId!

  const body = (await req.json().catch(() => null)) as {
    scanId?: unknown
    itemKey?: unknown
    disposition?: unknown
    note?: unknown
  } | null
  if (!body) return json(400, { error: 'Invalid JSON body' })

  const scanId = typeof body.scanId === 'string' && UUID.test(body.scanId) ? body.scanId : null
  if (!scanId) return json(400, { error: 'Expected the saved check.' })
  const itemKey = typeof body.itemKey === 'string' ? body.itemKey.trim() : ''
  if (!itemKey || itemKey.length > MAX_KEY) return json(400, { error: 'Expected the item.' })
  const disposition = body.disposition as ScanDisposition
  if (!SCAN_DISPOSITIONS.includes(disposition)) return json(400, { error: 'Unknown decision.' })
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, MAX_NOTE) : null

  const result = await saveScanDisposition(getAdminClient() as unknown as SupabaseClient<GeneratedDatabase>, {
    item: { scanId, itemKey },
    disposition,
    note,
    userId,
  })
  if (!result.ok) return json(result.reason === 'not_found' ? 404 : 500, { error: result.message })
  return json(200, { ok: true, itemId: result.itemId })
}
