import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/admin/contacts/merge — duplicate candidates awaiting review.
 *
 * Proposals only. Pairs are found on exact, case-insensitive email match
 * (decision §12.4), and nothing merges without a POST: a couple sharing an
 * inbox is indistinguishable from a duplicate by email alone, which is why
 * `names_match` is surfaced as the thing a reviewer should look at first.
 */
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { data, error } = await getAdminClient()
    .from('contact_merge_candidates')
    .select('*')
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const candidates = (data ?? []) as Array<Record<string, unknown>>
  return NextResponse.json({
    candidates,
    // Same-name pairs are the ones most likely to be genuine duplicates; the
    // rest are more often two people behind one mailbox.
    likelyDuplicates: candidates.filter(row => row.names_match === true).length,
  })
}

/**
 * POST /api/admin/contacts/merge — merge one reviewed pair.
 *
 * Deliberately one pair per call rather than "merge everything that matched":
 * this repoints matters, appointments, message history and design-sheet
 * references, and a bulk endpoint makes a wrong judgement expensive to undo.
 */
export async function POST(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => ({}))
  const winnerId = typeof body.winnerContactId === 'string' ? body.winnerContactId.trim() : ''
  const loserId = typeof body.loserContactId === 'string' ? body.loserContactId.trim() : ''
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null

  if (!UUID_RE.test(winnerId) || !UUID_RE.test(loserId)) {
    return NextResponse.json(
      { error: 'winnerContactId and loserContactId are required' },
      { status: 400 },
    )
  }
  if (winnerId === loserId) {
    return NextResponse.json({ error: 'A contact cannot be merged into itself' }, { status: 400 })
  }

  const { data, error } = await getAdminClient().rpc('merge_contacts', {
    p_winner_id: winnerId,
    p_loser_id: loserId,
    p_reason: reason,
    p_actor_id: userId,
  })

  if (error) {
    // The function's own validation (already merged, unknown contact) is a bad
    // request, not a server fault.
    const status = error.code === '22023' ? 409 : 500
    return NextResponse.json({ error: error.message }, { status })
  }

  const row = Array.isArray(data) ? data[0] : data
  return NextResponse.json({
    ok: true,
    matterLinksMoved: row?.matter_links_moved ?? 0,
    rolesMoved: row?.roles_moved ?? 0,
    messagesMoved: row?.messages_moved ?? 0,
    designSheetsRewritten: row?.design_sheets_rewritten ?? 0,
  })
}
