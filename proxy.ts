import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { safeClientRedirectPath } from '@/lib/auth/safeRedirect'

const ADMIN_ROLES = ['attorney', 'admin']

const SESSION_REQUIRED_PREFIXES = ['/admin', '/api/documents', '/api/admin', '/api/drafting']

function redirectToLogin(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone()
  url.pathname = '/auth/login'
  url.searchParams.set('type', 'admin')
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
      <p>We cannot load the drafting app right now. Please try again shortly.</p>
      <p class="path">Requested page: ${escapedPath}</p>
    </main>
  </body>
</html>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const searchParams = request.nextUrl.searchParams

  if (pathname === '/') {
    const url = request.nextUrl.clone()
    url.pathname = '/admin/drafting'
    return NextResponse.redirect(url)
  }

  if (pathname.startsWith('/api/health')) {
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

  if (userId && pathname === '/auth/login') {
    let role: string | null = claimRole ?? null
    if (!role) {
      const { data: userData } = await supabase
        .from('users')
        .select('role')
        .eq('id', userId)
        .single()
      role = userData?.role ?? null
    }

    const requestedRedirect = safeClientRedirectPath(searchParams.get('redirectTo'))
    const destinationPath =
      role && ADMIN_ROLES.includes(role)
        ? (requestedRedirect ?? '/admin/drafting')
        : '/auth/login?type=admin'

    return NextResponse.redirect(new URL(destinationPath, request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/', '/admin/:path*', '/auth/login', '/api/documents/:path*', '/api/admin/:path*', '/api/drafting/:path*'],
}
