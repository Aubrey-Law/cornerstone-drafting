import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import {
  DEFAULT_ADMIN_HOME,
  safeAdminRedirectPath,
  safeClientRedirectPath,
} from '@/lib/auth/safeRedirect'
import { profileServerRequest } from '@/lib/performance/serverRequestTiming'

const ADMIN_ROLES = ['attorney', 'admin']
const CLIENT_ROLE = 'client'

const ADMIN_PREFIXES = ['/admin', '/api/admin', '/api/drafting']
const PORTAL_PATHS = ['/dashboard', '/documents', '/messages', '/intake', '/schedule']
/** Public client onboarding — must not require an existing session. */
const PUBLIC_AUTH_PATHS = [
  '/intake/auth',
  '/intake/start',
  '/api/intake/signup',
  '/api/intake/register',
]
const SESSION_REQUIRED_PREFIXES = [
  ...ADMIN_PREFIXES,
  '/api/documents',
  '/api/messages',
  '/api/intake',
  ...PORTAL_PATHS,
]

function isPublicAuthPath(pathname: string) {
  return PUBLIC_AUTH_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

function isAdminPath(pathname: string) {
  return ADMIN_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

function isPortalPath(pathname: string) {
  if (pathname === '/intake/auth' || pathname.startsWith('/intake/auth/')) return false
  return PORTAL_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

function isApiPath(pathname: string) {
  return pathname === '/api' || pathname.startsWith('/api/')
}

/**
 * Deny an unauthenticated request. API paths get a JSON status code rather than
 * a redirect: `fetch()` follows redirects transparently, so a 307 to the login
 * page arrives as a 200 HTML body with `res.ok === true`, and call sites that do
 * `await res.json().catch(() => [])` then render an empty list as if the data
 * were genuinely empty instead of surfacing an expired session.
 */
function denyRequest(request: NextRequest, pathname: string, status: 401 | 403 = 401) {
  if (isApiPath(pathname)) {
    return NextResponse.json(
      { error: status === 403 ? 'Forbidden' : 'Unauthorized' },
      { status },
    )
  }
  const url = request.nextUrl.clone()
  url.pathname = '/auth/login'
  url.searchParams.set('redirectTo', pathname)
  return NextResponse.redirect(url)
}

function redirectToLogin(request: NextRequest, pathname: string) {
  return denyRequest(request, pathname, 401)
}

function supabaseUnavailable(pathname: string) {
  const escapedPath = pathname.replace(/[<>&"]/g, (ch) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
  }[ch] ?? ch))

  return new NextResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>App temporarily unavailable</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif; background: #f8fafc; color: #172033; }
      main { max-width: 480px; padding: 32px; text-align: center; }
    </style>
  </head>
  <body>
    <main>
      <h1>App temporarily unavailable</h1>
      <p>We cannot load the app right now. Please try again shortly.</p>
      <p class="path">Requested page: ${escapedPath}</p>
    </main>
  </body>
</html>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

async function resolveRole(
  supabase: ReturnType<typeof createServerClient>,
  userId: string,
  claimRole: string | undefined,
): Promise<string | null> {
  if (claimRole) return claimRole
  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .single()
  return userData?.role ?? null
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const searchParams = request.nextUrl.searchParams

  if (pathname === '/') {
    const url = request.nextUrl.clone()
    url.pathname = DEFAULT_ADMIN_HOME
    return NextResponse.redirect(url)
  }

  if (pathname.startsWith('/api/health') || pathname.startsWith('/api/webhooks')) {
    return NextResponse.next()
  }

  if (isPublicAuthPath(pathname)) {
    return NextResponse.next()
  }

  const requiresSession = SESSION_REQUIRED_PREFIXES.some(
    p => pathname === p || pathname.startsWith(`${p}/`),
  )
  const shouldRedirectAuthenticatedLogin = pathname === '/auth/login'

  if (!requiresSession && !shouldRedirectAuthenticatedLogin) {
    return NextResponse.next()
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseUnavailable(pathname)
  }

  const profiled = await profileServerRequest('proxy', async measure => {
    let supabaseResponse = NextResponse.next({ request })
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
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
    })

    const { data: claimsData } = await measure('auth', () => supabase.auth.getClaims())
    const userId = claimsData?.claims.sub
    const claimRole = (claimsData?.claims as Record<string, unknown> | undefined)?.user_role as
      | string
      | undefined

    if (requiresSession && !userId) {
      return redirectToLogin(request, pathname)
    }

    if (userId && (requiresSession || shouldRedirectAuthenticatedLogin)) {
      // Admin pages and API routes perform their own role check before serving
      // protected content. When an older session lacks the JWT claim, defer to
      // that check instead of adding a duplicate edge-to-database round trip.
      if (isAdminPath(pathname) && !claimRole) {
        return supabaseResponse
      }

      const role = await measure('role', () => resolveRole(supabase, userId, claimRole))

      if (pathname === '/auth/login') {
        const adminRedirect = safeAdminRedirectPath(searchParams.get('redirectTo'))
        const clientRedirect = safeClientRedirectPath(searchParams.get('redirectTo'))
        let destinationPath = '/auth/login'
        if (role && ADMIN_ROLES.includes(role)) {
          destinationPath = adminRedirect ?? DEFAULT_ADMIN_HOME
        } else if (role === CLIENT_ROLE) {
          destinationPath = clientRedirect ?? '/dashboard'
        }
        return NextResponse.redirect(new URL(destinationPath, request.url))
      }

      if (isAdminPath(pathname) && (!role || !ADMIN_ROLES.includes(role))) {
        if (isApiPath(pathname)) return denyRequest(request, pathname, 403)
        if (role === CLIENT_ROLE) {
          return NextResponse.redirect(new URL('/dashboard', request.url))
        }
        return redirectToLogin(request, pathname)
      }

      if (isPortalPath(pathname) && role !== CLIENT_ROLE) {
        if (isApiPath(pathname)) return denyRequest(request, pathname, 403)
        if (role && ADMIN_ROLES.includes(role)) {
          return NextResponse.redirect(new URL(DEFAULT_ADMIN_HOME, request.url))
        }
        return redirectToLogin(request, pathname)
      }
    }

    return supabaseResponse
  })
  profiled.value.headers.append('Server-Timing', profiled.serverTiming)
  return profiled.value
}

export const config = {
  matcher: [
    '/',
    '/admin/:path*',
    '/auth/login',
    '/dashboard/:path*',
    '/documents/:path*',
    '/messages/:path*',
    '/intake/:path*',
    '/api/documents/:path*',
    '/api/admin/:path*',
    '/api/drafting/:path*',
    '/api/messages/:path*',
    '/api/intake/:path*',
  ],
}
