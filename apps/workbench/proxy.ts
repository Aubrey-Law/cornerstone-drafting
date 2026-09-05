import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'
import { LOGIN_PATH, classifyPath, decide } from '@/lib/auth/gate'
import { resolveRole, resolveSession } from '@/lib/auth/session'
import { readUserRole } from '@/lib/supabase/roles'
import { toResponse, unavailableResponse } from '@/lib/auth/respond'

/**
 * The access-control gate for every request this app serves.
 *
 * This file is deliberately thin. The rules live in `lib/auth/gate.ts` as a
 * pure function so they can be read and tested as a table; session reading
 * lives in `lib/auth/session.ts` behind a structural interface so its
 * fail-closed behaviour is testable without a Supabase instance; and the
 * translation to a response lives in `lib/auth/respond.ts`. What is left here
 * is the wiring plus the cookie refresh, which is the one part that genuinely
 * needs the framework.
 *
 * This file must also simply exist. Next resolves `proxy.ts` by walking up from
 * the app directory, so without a local copy this app silently runs the root
 * app's middleware — its role routing, its public carve-outs, its redirects to
 * screens that do not exist here. The build succeeds and the wrong gate runs.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  // A public path needs no session, and therefore must not need Supabase to be
  // configured. `/api/health` is how a monitor asks whether this app is up.
  if (pathname !== LOGIN_PATH && classifyPath(pathname) === 'public') {
    return NextResponse.next()
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return unavailableResponse(request)

  // Reassigned by setAll below, so a refreshed session cookie reaches the
  // browser. Returning a response built before the refresh silently signs the
  // user out when their token rotates.
  let supabaseResponse = NextResponse.next({ request })

  // Annotated rather than inferred. The full return type of createServerClient
  // carries enough generic machinery that passing it on unannotated makes tsc
  // give up resolving the query builder downstream (TS2589).
  const supabase: SupabaseClient<WorkbenchDatabase> = createServerClient<WorkbenchDatabase>(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const session = await resolveSession(supabase)
  // Could not determine who is asking. Serve nothing rather than serving it
  // ungated, and do not read it as "anonymous" — that would sign every user out
  // during an auth outage.
  if (!session.ok) return unavailableResponse(request)

  const role = session.userId
    ? await resolveRole((id) => readUserRole(supabase, id), session.userId, session.claimRole)
    : null

  const decision = decide({
    pathname,
    redirectTo: request.nextUrl.searchParams.get('redirectTo'),
    userId: session.userId,
    role,
  })

  return toResponse(decision, request) ?? supabaseResponse
}

/**
 * Every gated path family must appear here or the proxy never runs for it.
 * Next requires a statically analysable literal, so this cannot be derived from
 * `GATED_PATH_PATTERNS`; `tests/proxy.test.ts` cross-checks the two instead.
 */
export const config = {
  matcher: [
    '/',
    '/funding/:path*',
    '/matters/:path*',
    '/review/:path*',
    '/tasks/:path*',
    '/library/:path*',
    '/settings/:path*',
    '/portal/:path*',
    '/auth/login',
    '/api/staff/:path*',
    '/api/portal/:path*',
  ],
}
