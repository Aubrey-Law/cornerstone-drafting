import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_LOSERS_PER_CALL = 200

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

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('contact_merge_candidates')
    .select('*')
    // One row per copy now, not per pair, so this covers every group in
    // practice; the cap only guards against a pathological import.
    .limit(2000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const pairs = (data ?? []) as Array<Record<string, unknown>>
  if (pairs.length === 0) return NextResponse.json({ candidates: [], likelyDuplicates: 0 })

  // The view answers "which pairs" — reviewing them needs the whole person on
  // both sides, and the matters each is on. Nobody can judge a merge from two
  // names and a count.
  const ids = [...new Set(pairs.flatMap(p => [String(p.winner_contact_id), String(p.loser_contact_id)]))]

  const [{ data: contacts }, { data: links }] = await Promise.all([
    admin
      .from('contacts')
      .select('id, first_name, middle_name, last_name, preferred_name, email, phone, city, state, date_of_birth, relationship_type, relationship_label, created_at')
      .in('id', ids),
    admin.from('matter_contacts').select('contact_id, relationship_type, matter_id').in('contact_id', ids),
  ])

  const matterIds = [...new Set(((links ?? []) as Array<{ matter_id: string }>).map(l => l.matter_id))]
  const { data: matters } = matterIds.length
    ? await admin.from('matters').select('id, matter_number, name, relationship_status').in('id', matterIds)
    : { data: [] as Array<Record<string, unknown>> }

  const matterById = new Map(((matters ?? []) as Array<{ id: string }>).map(m => [m.id, m]))
  const contactById = new Map(((contacts ?? []) as Array<{ id: string }>).map(c => [c.id, c]))

  const mattersByContact = new Map<string, Array<Record<string, unknown>>>()
  for (const link of (links ?? []) as Array<{ contact_id: string; relationship_type: string; matter_id: string }>) {
    const matter = matterById.get(link.matter_id)
    if (!matter) continue
    mattersByContact.set(link.contact_id, [
      ...(mattersByContact.get(link.contact_id) ?? []),
      { ...matter, relationship_type: link.relationship_type },
    ])
  }

  const side = (id: string) => ({
    ...(contactById.get(id) ?? { id }),
    matters: mattersByContact.get(id) ?? [],
  })

  const candidates = pairs.map(pair => ({
    winner: side(String(pair.winner_contact_id)),
    loser: side(String(pair.loser_contact_id)),
    email: pair.email as string,
    namesMatch: pair.names_match === true,
  }))

  return NextResponse.json({
    candidates,
    // Same-name pairs are the ones most likely to be genuine duplicates; the
    // rest are more often two people behind one mailbox.
    likelyDuplicates: candidates.filter(c => c.namesMatch).length,
  })
}

/**
 * POST /api/admin/contacts/merge — merge reviewed copies into one person.
 *
 * Takes one winner and either `loserContactId` or `loserContactIds`. The list
 * form exists for the case the review page groups: one person entered dozens
 * of times. Each copy is still its own `merge_contacts` call (its own
 * transaction and log line), so a failure part-way leaves every earlier merge
 * complete and reported, never half-applied.
 */
export async function POST(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => ({}))
  const winnerId = typeof body.winnerContactId === 'string' ? body.winnerContactId.trim() : ''
  const loserIds: string[] = Array.isArray(body.loserContactIds)
    ? body.loserContactIds.filter((id: unknown): id is string => typeof id === 'string').map((id: string) => id.trim())
    : typeof body.loserContactId === 'string' ? [body.loserContactId.trim()] : []
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null

  if (!UUID_RE.test(winnerId) || loserIds.length === 0 || !loserIds.every(id => UUID_RE.test(id))) {
    return NextResponse.json(
      { error: 'winnerContactId and loserContactId (or loserContactIds) are required' },
      { status: 400 },
    )
  }
  if (loserIds.length > MAX_LOSERS_PER_CALL) {
    return NextResponse.json(
      { error: `At most ${MAX_LOSERS_PER_CALL} contacts can be merged in one request` },
      { status: 400 },
    )
  }
  if (loserIds.includes(winnerId)) {
    return NextResponse.json({ error: 'A contact cannot be merged into itself' }, { status: 400 })
  }

  const admin = getAdminClient()
  const totals = { merged: 0, matterLinksMoved: 0, rolesMoved: 0, messagesMoved: 0, designSheetsRewritten: 0 }

  for (const loserId of [...new Set(loserIds)]) {
    const { data, error } = await admin.rpc('merge_contacts', {
      p_winner_id: winnerId,
      p_loser_id: loserId,
      p_reason: reason,
      p_actor_id: userId,
    })

    if (error) {
      // The function's own validation (already merged, unknown contact) is a
      // conflict, not a server fault.
      const status = error.code === '22023' ? 409 : 500
      return NextResponse.json({ error: error.message, ...totals }, { status })
    }

    const row = Array.isArray(data) ? data[0] : data
    totals.merged += 1
    totals.matterLinksMoved += row?.matter_links_moved ?? 0
    totals.rolesMoved += row?.roles_moved ?? 0
    totals.messagesMoved += row?.messages_moved ?? 0
    totals.designSheetsRewritten += row?.design_sheets_rewritten ?? 0
  }

  return NextResponse.json({ ok: true, ...totals })
}
