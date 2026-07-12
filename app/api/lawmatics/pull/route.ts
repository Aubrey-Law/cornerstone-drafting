import { NextResponse } from 'next/server'
import { getValidToken, searchProspects } from '@/lib/lawmatics'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { importMatterFromLawmaticsProspect } from '@/lib/lawmatics/importMatter'

// GET /api/lawmatics/pull?q=name|email|phone
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const { err } = await requireAdmin(req)
  if (err) return err

  const q = searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ error: 'Provide ?q=name, email, or phone' }, { status: 400 })

  const stored = await getValidToken()
  if (!stored) {
    return NextResponse.json({ error: 'Lawmatics not connected — reconnect in the Import dialog' }, { status: 401 })
  }

  try {
    const matches = await searchProspects(stored.access_token, q)
    return NextResponse.json({ matches })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Lawmatics search failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

// POST /api/lawmatics/pull { lm_id }
export async function POST(req: Request) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const stored = await getValidToken()
  if (!stored) {
    return NextResponse.json({ error: 'Lawmatics not connected — reconnect in the Import dialog' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const lmId = typeof body.lm_id === 'string' ? body.lm_id.trim() : ''
  const target = body.target === 'lead' ? 'lead' : 'matter'
  if (!lmId) return NextResponse.json({ error: 'Provide lm_id' }, { status: 400 })

  try {
    const admin = getAdminClient()
    const result = await importMatterFromLawmaticsProspect(admin, stored.access_token, lmId, userId, target)
    return NextResponse.json({
      ok: true,
      matterId: result.matterId,
      leadId: result.leadId,
      created: result.created,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Import failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
