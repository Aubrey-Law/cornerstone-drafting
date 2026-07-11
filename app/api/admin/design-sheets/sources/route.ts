import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

// GET /api/admin/design-sheets/sources?exclude=<matterId>
// Matters with a design sheet, newest sheet first — the picker list for
// "Copy plan structure from another matter".
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const exclude = new URL(req.url).searchParams.get('exclude')
  const admin = getAdminClient()

  const { data: sheets, error } = await admin
    .from('design_sheets')
    .select('matter_id, plan_type, updated_at')
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const matterIds = (sheets ?? []).map(s => s.matter_id).filter(id => id !== exclude)
  if (matterIds.length === 0) return NextResponse.json({ sources: [] })

  const { data: matters, error: mattersError } = await admin
    .from('v_matter_pipeline')
    .select('matter_id, matter_name, client_name')
    .in('matter_id', matterIds)
  if (mattersError) return NextResponse.json({ error: mattersError.message }, { status: 500 })

  const matterById = new Map((matters ?? []).map(m => [m.matter_id, m]))
  const sources = (sheets ?? [])
    .filter(s => s.matter_id !== exclude && matterById.has(s.matter_id))
    .map(s => {
      const matter = matterById.get(s.matter_id)
      return {
        matter_id: s.matter_id,
        client_name: (matter?.client_name as string | null) ?? null,
        matter_name: (matter?.matter_name as string | null) ?? null,
        plan_type: (s.plan_type as string | null) ?? null,
        updated_at: s.updated_at as string,
      }
    })

  return NextResponse.json({ sources })
}
