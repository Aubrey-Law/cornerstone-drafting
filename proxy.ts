import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import {
  DEFAULT_ADMIN_HOME,
  safeAdminRedirectPath,
  safeClientRedirectPath,
} from '@/lib/auth/safeRedirect'

const ADMIN_ROLES = ['attorney', 'admin']
const CLIENT_ROLE = 'client'

const ADMIN_PREFIXES = ['/admin', '/api/admin', '/api/drafting']
const PORTAL_PATHS = ['/dashboard', '/documents', '/messages', '/intake']
/** Public client onboarding — must not require an existing session. */
const PUBLIC_AUTH_PATHS = ['/intake/auth', '/api/intake/signup']
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

function redirectToLogin(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone()
  url.pathname = '/auth/login'
  url.searchParams.set('redirectTo', pathname)
  return NextResponse.redirect(url)
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

  let supabaseResponse = NextResponse.next({ request })
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseUnavailable(pathname)
  }

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

  const { data: claimsData } = await supabase.auth.getClaims()
  const userId = claimsData?.claims.sub
  const claimRole = (claimsData?.claims as Record<string, unknown> | undefined)?.user_role as
    | string
    | undefined

  if (requiresSession && !userId) {
    return redirectToLogin(request, pathname)
  }

  if (userId && (requiresSession || shouldRedirectAuthenticatedLogin)) {
    const role = await resolveRole(supabase, userId, claimRole)

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
      if (role === CLIENT_ROLE) {
        return NextResponse.redirect(new URL('/dashboard', request.url))
      }
      return redirectToLogin(request, pathname)
    }

    if (isPortalPath(pathname) && role !== CLIENT_ROLE) {
      if (role && ADMIN_ROLES.includes(role)) {
        return NextResponse.redirect(new URL(DEFAULT_ADMIN_HOME, request.url))
      }
      return redirectToLogin(request, pathname)
    }
  }

  return supabaseResponse
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
