import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'
import { normalizeMatterType } from '@/lib/matter/matterType'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GeneratedDatabase } from '@/types/supabase'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const body = await req.json().catch(() => null) as { matterType?: unknown } | null
  const matterType = normalizeMatterType(body?.matterType)
  if (!matterType) {
    return NextResponse.json(
      { error: 'Matter type must be individual or couple' },
      { status: 400 },
    )
  }

  try {
    const compatibilityAdmin = getAdminClient()
    const { id: rawId } = await params
    const matterId = await resolveMatterId(rawId, compatibilityAdmin)
    const admin = compatibilityAdmin as unknown as SupabaseClient<GeneratedDatabase>
    const { data, error } = await admin
      .from('matters')
      .update({ matter_type: matterType })
      .eq('id', matterId)
      .eq('relationship_status', 'hired')
      .select('id, matter_type')
      .maybeSingle()

    if (error) throw new Error(error.message)
    if (!data) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
    return NextResponse.json({ matterId, matterType: data.matter_type })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not update matter type' },
      { status: 500 },
    )
  }
}
