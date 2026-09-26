import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isUuid } from '@/lib/queries/tasks'
import { loadRunSummaries } from '@/lib/review/history'
import type { GeneratedDatabase } from '@/types/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/matters/[id]/reviews
 *
 * The matter's recorded reviews, newest first: its filed documents' reviews,
 * and those of every upload linked to it — a prior plan, or a snapshot the
 * Word add-in kept of the firm's draft.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid matter id' }, { status: 400 })

  try {
    const client = getAdminClient() as unknown as SupabaseClient<GeneratedDatabase>
    return NextResponse.json({ reviews: await loadRunSummaries(client, 100, { matterId: id }) })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load reviews' },
      { status: 500 },
    )
  }
}
