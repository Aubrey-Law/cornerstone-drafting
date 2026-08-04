import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { fetchFirmPeople, toEmailDirectory } from '@/lib/queries/firmDirectory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/email/directory
 *
 * Every address the firm might email, for the compose pane's To/Cc/Bcc
 * typeahead. Loaded once per pane mount and filtered in the browser — a few
 * hundred rows, so no per-keystroke request.
 *
 * Matter people win over leads on a shared address, and both win over
 * relationship contacts, so the most specific label is the one shown. Shares
 * `fetchFirmPeople()` with the phone directory so the two can't drift again.
 */
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { people, error } = await fetchFirmPeople()
  if (error) return NextResponse.json({ error }, { status: 500 })

  return NextResponse.json(
    { entries: toEmailDirectory(people) },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  )
}
