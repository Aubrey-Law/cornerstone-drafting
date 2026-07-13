import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/apiAuth'
import { generateUniqueMatterNumber } from '@/lib/matterNumber'

type Params = { params: Promise<{ id: string }> }

// Allocate (but do not persist) the next sequential matter number for a matter.
// The overview persists the returned value via matter-details PATCH. Year is taken
// from the matter's created_at so a matter created in a prior year keeps that
// year's prefix. Refuses when the matter number was manually set.
export async function POST(req: NextRequest, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params
  const admin = getAdminClient()

  const { data: matter, error: matterErr } = await admin
    .from('matters')
    .select('id, created_at, matter_number_manual, client_intake_id')
    .eq('id', matterId)
    .eq('relationship_status', 'hired')
    .maybeSingle()
  if (matterErr) return NextResponse.json({ error: matterErr.message }, { status: 500 })
  if (!matter) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })

  if (matter.matter_number_manual) {
    return NextResponse.json(
      { error: 'Matter number was manually set and cannot be auto-generated' },
      { status: 409 },
    )
  }

  const [{ data: details }, { data: intake }] = await Promise.all([
    admin.from('matter_details').select('practice_area').eq('client_id', matterId).maybeSingle(),
    matter.client_intake_id
      ? admin
          .from('client_intake')
          .select('first_name, last_name')
          .eq('id', matter.client_intake_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const year = matter.created_at
    ? new Date(matter.created_at).getUTCFullYear()
    : new Date().getFullYear()

  try {
    const matterNumber = await generateUniqueMatterNumber(admin, {
      year,
      practiceArea: details?.practice_area ?? null,
      clientLastName: intake?.last_name ?? null,
      clientFirstName: intake?.first_name ?? null,
    })
    return NextResponse.json({ matterNumber })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'allocation failed' },
      { status: 500 },
    )
  }
}
