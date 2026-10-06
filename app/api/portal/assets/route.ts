import { NextResponse } from 'next/server'
import { getBearerUser } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { getMatterForUser } from '@/lib/portal/getMatterForUser'
import { parseClientAssetInput } from '@/lib/funding/portal'
import { createClientAsset, fetchPortalAssets } from '@/lib/funding/portalServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/portal/assets — the client's own assets and their funding state.
 *
 * GET lists them; POST adds one the firm does not know about. Both resolve the
 * signed-in client to their hired matter first and act only on that matter,
 * so no id in the request chooses whose assets these are.
 */

async function resolveMatter(req: Request) {
  const user = await getBearerUser(req)
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const matter = await getMatterForUser(getAdminClient(), user.id)
  if (!matter) return { error: NextResponse.json({ error: 'Your matter is not set up yet' }, { status: 404 }) }
  return { user, matter }
}

export async function GET(req: Request) {
  const resolved = await resolveMatter(req)
  if ('error' in resolved) return resolved.error
  try {
    return NextResponse.json({ assets: await fetchPortalAssets(resolved.matter.id) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load your assets' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const resolved = await resolveMatter(req)
  if ('error' in resolved) return resolved.error
  if (resolved.matter.status === 'closed') {
    return NextResponse.json({ error: 'This matter is closed; nothing more can be added', code: 'matter_closed' }, { status: 409 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  let asset
  try {
    asset = parseClientAssetInput(body)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid asset' }, { status: 400 })
  }

  try {
    const created = await createClientAsset({ matterId: resolved.matter.id, asset })
    const assets = await fetchPortalAssets(resolved.matter.id)
    return NextResponse.json({ assetId: created.assetId, assets }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not add the asset' }, { status: 500 })
  }
}
