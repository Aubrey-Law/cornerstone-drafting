import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

/**
 * This file must exist, even empty.
 *
 * Next resolves the `proxy.ts` convention file by walking up from the app
 * directory. With no local copy, the workbench silently adopts the ROOT app's
 * proxy — its admin/client role routing, its public-path carve-outs, and its
 * redirects to screens this app does not have. The failure is not loud: the
 * build succeeds and the wrong middleware runs.
 *
 * The root proxy is also not the one this app wants. Per the overhaul plan it
 * is rewritten rather than ported, keeping only its three real security
 * decisions:
 *   - JSON 401/403 for API paths, never a redirect (a 307 to login arrives as
 *     a 200 and renders as empty data)
 *   - role resolution falling back to the `users` table when the JWT claim is
 *     absent
 *   - failing closed to 503 when Supabase is unavailable
 *
 * None of that is implemented yet: the workbench has no authenticated surface
 * until the portal lands. Until then this matches nothing and does nothing.
 * `tests/proxy-isolation.test.ts` fails if this file is removed.
 */
export function proxy(_request: NextRequest) {
  return NextResponse.next()
}

export const config = {
  // Matches nothing. Next requires this object to be statically parseable, so
  // it is a literal; the path is a sentinel that no route will ever use.
  matcher: ['/__workbench-proxy-inactive'],
}
