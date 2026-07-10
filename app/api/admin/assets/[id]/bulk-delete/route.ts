import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/apiAuth'
import { syncAssetIntakeToDesignSheetForIntake } from '@/lib/assets/syncAssetIntakeToDesignSheet'
import { getAdminClient } from '@/lib/supabaseAdmin'

const MAX_BULK_DELETE = 100

function makeClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const token = req.headers.get('authorization')?.replace('Bearer ', '') ?? ''
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: clientIntakeId } = await params
  let body: { asset_ids?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const assetIds = Array.isArray(body.asset_ids)
    ? body.asset_ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []

  if (assetIds.length === 0) {
    return NextResponse.json({ error: 'No asset ids provided' }, { status: 400 })
  }
  if (assetIds.length > MAX_BULK_DELETE) {
    return NextResponse.json({ error: `Bulk delete is limited to ${MAX_BULK_DELETE} assets` }, { status: 400 })
  }

  const sb = makeClient(token)
  const { data, error } = await sb
    .from('asset_intake')
    .delete()
    .eq('client_intake_id', clientIntakeId)
    .in('id', assetIds)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const deleted = data?.length ?? 0
  if (deleted > 0) {
    void syncAssetIntakeToDesignSheetForIntake(getAdminClient(), clientIntakeId)
  }

  return NextResponse.json({ ok: true, deleted, requested: assetIds.length })
}
