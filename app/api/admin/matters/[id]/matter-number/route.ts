import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { generateUniqueMatterNumber } from '@/lib/matterNumber'

type Params = { params: Promise<{ id: string }> }

// Allocate (but do not persist) the next sequential matter number for a matter.
// The Details tab reflects the returned value and persists it via its existing
// saveField flow. Year is taken from the matter's created_at so a matter created
// in a prior year keeps that year's prefix.
export async function POST(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params
  const admin = getAdminClient()

  const { data: matter, error: matterErr } = await admin
    .from('matters')
    .select('id, created_at')
    .eq('id', matterId)
    .maybeSingle()
  if (matterErr) return NextResponse.json({ error: matterErr.message }, { status: 500 })
  if (!matter) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })

  const { data: details } = await admin
    .from('matter_details')
    .select('practice_area')
    .eq('client_id', matterId)
    .maybeSingle()

  const year = matter.created_at
    ? new Date(matter.created_at).getUTCFullYear()
    : new Date().getFullYear()

  try {
    const matterNumber = await generateUniqueMatterNumber(admin, {
      year,
      practiceArea: details?.practice_area ?? null,
    })
    return NextResponse.json({ matterNumber })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'allocation failed' },
      { status: 500 },
    )
  }
}
