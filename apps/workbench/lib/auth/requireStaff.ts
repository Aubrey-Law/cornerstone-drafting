import { NextResponse } from 'next/server'
import { isStaffRole } from '@/lib/auth/gate'
import { getSessionUser, type SessionUser } from '@/lib/supabase/server'

/**
 * The second lock on a staff route.
 *
 * The proxy already gates `/api/staff/*`, but its matcher is a list a person
 * maintains. A route that also checks for itself cannot be exposed by an edit
 * to that list — and the plan is explicit that the real gate is the route's own
 * check, with the middleware as defence in depth rather than the other way
 * round.
 */
export async function requireStaff(): Promise<
  { error: null; user: SessionUser } | { error: NextResponse; user: null }
> {
  const user = await getSessionUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), user: null }
  }
  if (!isStaffRole(user.role)) {
    // Authenticated and simply not allowed. 401 would tell the caller to
    // re-authenticate, which cannot help.
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), user: null }
  }
  return { error: null, user }
}
