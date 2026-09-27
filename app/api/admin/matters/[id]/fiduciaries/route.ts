import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isUuid } from '@/lib/queries/tasks'
import { loadMatterFiduciaryView } from '@/lib/fiduciary/view'
import type { GeneratedDatabase } from '@/types/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/matters/[id]/fiduciaries
 *
 * Who holds which office on this matter, in order of service, and what is
 * missing or contradictory about it — the fiduciary matrix.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid matter id' }, { status: 400 })

  try {
    const client = getAdminClient() as unknown as SupabaseClient<GeneratedDatabase>
    const view = await loadMatterFiduciaryView(client, id)
    if (!view) return NextResponse.json({ error: 'Matter not found' }, { status: 404 })
    return NextResponse.json({ fiduciaries: view })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load fiduciaries' },
      { status: 500 },
    )
  }
}
