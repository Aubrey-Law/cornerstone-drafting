import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { buildMatterBrief } from '@/lib/drafting/matterBrief'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * The design sheet for one matter, for the pane to show before drafting from it.
 *
 * The chat route builds the same brief for itself rather than calling this —
 * one round trip, and a brief that cannot drift from the one the model was
 * actually given. This endpoint exists so the attorney can see what Cornerstone
 * knows, and above all what it does not: linking a matter and finding six
 * `[UNKNOWN]`s is the moment to go fill the sheet in, not after a draft has
 * been built on them.
 *
 * `requireAdmin(req)` rather than the middleware: `/api/addin/*` is outside
 * `proxy.ts`'s matcher because that resolves sessions from cookies and would
 * reject the pane's bearer token. See `tests/addin-route-auth.test.ts`.
 */
export async function GET(req: Request, { params }: Params) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id } = await params
  const result = await buildMatterBrief(id)

  if (!result.ok) {
    // 409, not 404: the matter generally exists, its design sheet is not ready
    // to draft from. The reason is the one `buildDraftPayload` raised, which
    // names which of the two it was.
    return NextResponse.json({ error: result.reason }, { status: 409 })
  }

  return NextResponse.json(result.brief, { headers: { 'Cache-Control': 'no-store' } })
}
