import { NextResponse } from 'next/server'
import { getBearerUser } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getMatterForUser } from '@/lib/portal/getMatterForUser'
import { isUuid } from '@/lib/queries/tasks'
import { parseClientReportNote } from '@/lib/funding/portal'
import { fetchPortalAssets, recordClientRetitling } from '@/lib/funding/portalServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/assets/[assetId]/done — the client says a funding step is
 * done without a document to show for it (the upload route handles the case
 * with one). The asset moves to awaiting confirmation and the firm is asked to
 * check; nothing here marks anything confirmed.
 */
export async function POST(req: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const user = await getBearerUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const matter = await getMatterForUser(getAdminClient(), user.id)
  if (!matter) return NextResponse.json({ error: 'Your matter is not set up yet' }, { status: 404 })
  if (matter.status === 'closed') {
    return NextResponse.json({ error: 'This matter is closed', code: 'matter_closed' }, { status: 409 })
  }

  const { assetId } = await params
  if (!isUuid(assetId)) return NextResponse.json({ error: 'That asset is not on your matter' }, { status: 404 })
  const body = await req.json().catch(() => ({}))

  try {
    const result = await recordClientRetitling({
      matterId: matter.id,
      assetId,
      documentId: null,
      note: parseClientReportNote(body),
      actorId: user.id,
    })
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
    return NextResponse.json({ ok: true, assets: await fetchPortalAssets(matter.id) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not record that' }, { status: 500 })
  }
}
