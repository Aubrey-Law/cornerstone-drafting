import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { syncAssetIntakeToDesignSheet } from '@/lib/assets/syncAssetIntakeToDesignSheet'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params
  const admin = getAdminClient()

  const { data: matter, error: matterErr } = await admin
    .from('matters')
    .select('client_intake_id, relationship_status')
    .eq('id', matterId)
    .maybeSingle()

  if (matterErr) return NextResponse.json({ error: matterErr.message }, { status: 500 })
  if (matter?.relationship_status !== 'hired') {
    return NextResponse.json({ error: 'Drafting is available only for hired matters' }, { status: 409 })
  }
  if (!matter?.client_intake_id) {
    return NextResponse.json({ error: 'No intake linked to this matter' }, { status: 404 })
  }

  try {
    const result = await syncAssetIntakeToDesignSheet(admin, matterId, matter.client_intake_id)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Asset sync failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
