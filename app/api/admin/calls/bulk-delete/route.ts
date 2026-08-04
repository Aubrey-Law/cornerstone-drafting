import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { revalidateSidebarCounts } from '@/lib/sidebarCountsInvalidation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** One dialog should not be able to wipe the whole call log by accident. */
const MAX_IDS = 200

export async function POST(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null
  const ids = body?.ids

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 })
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: `Delete at most ${MAX_IDS} calls at a time` }, { status: 400 })
  }
  if (!ids.every((id): id is string => typeof id === 'string' && UUID_RE.test(id))) {
    return NextResponse.json({ error: 'ids must all be call ids' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { error } = await admin.from('calls').delete().in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidateSidebarCounts()
  return NextResponse.json({ deleted: ids.length })
}
