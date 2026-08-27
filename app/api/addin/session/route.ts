import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

/**
 * Who am I? — the Word task pane's sign-in check.
 *
 * The `/api/addin/*` prefix sits deliberately outside `proxy.ts`'s matcher.
 * That middleware resolves the Supabase session from cookies only, so it would
 * 401 the pane's bearer-token request before it ever reached a handler. Every
 * route under this prefix therefore has to gate itself with `requireAdmin`,
 * which does understand `Authorization: Bearer`. `tests/addin-route-auth.test.ts`
 * enforces that none of them forget.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const admin = getAdminClient()
  const { data: profile } = await admin
    .from('users')
    .select('role, display_name')
    .eq('id', auth.userId!)
    .maybeSingle()

  return NextResponse.json(
    {
      userId: auth.userId,
      email: auth.user?.email ?? null,
      name: profile?.display_name ?? null,
      role: profile?.role ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
