import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { listReviewPlaybooks } from '@/lib/addinReview/playbooks'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

/**
 * The published review playbooks, for the pane's Review tab picker.
 *
 * `requireAdmin(req)` rather than the middleware: `/api/addin/*` is outside
 * `proxy.ts`'s matcher. See `tests/addin-route-auth.test.ts`.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  try {
    const playbooks = await listReviewPlaybooks(getAdminClient())
    return NextResponse.json({ playbooks }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load playbooks.' },
      { status: 500 },
    )
  }
}
