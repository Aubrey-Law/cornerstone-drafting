import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { fetchFirmPeople, toPhoneDirectory } from '@/lib/queries/firmDirectory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/phone/directory
 *
 * Every phone number the firm might dial or receive, mapped to its matter,
 * lead or contact. Consumed by the softphone to name callers and link calls.
 *
 * Shares `fetchFirmPeople()` with the email directory. It previously read
 * `v_matter_pipeline` (hired matters only) and fell back to intakes filtered
 * `matter_id is null` — a filter the unify-leads-matters backfill made match
 * nothing — so it listed hired clients and their spouses and no one else.
 */
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { people, error } = await fetchFirmPeople()
  if (error) return NextResponse.json({ error }, { status: 500 })

  return NextResponse.json(
    { entries: toPhoneDirectory(people) },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  )
}
