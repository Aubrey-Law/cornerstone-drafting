import { NextResponse, type NextRequest } from 'next/server'
import { LOGIN_PATH, type Decision } from './gate'

function isApi(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/')
}

/**
 * Translate a gate decision into a response, or null to let the caller return
 * its own session-refreshing response.
 *
 * The one rule worth stating: an API path is answered with a JSON status code,
 * never a redirect. `fetch()` follows redirects transparently, so a 307 to the
 * login page arrives at the call site as a 200 with an HTML body and
 * `res.ok === true`. A call site doing `await res.json().catch(() => [])` then
 * renders an empty list as though the data were genuinely empty, and an expired
 * session looks like a client with no documents.
 */
export function toResponse(decision: Decision, request: NextRequest): NextResponse | null {
  const { pathname, search } = request.nextUrl

  if (decision.kind === 'pass') return null

  if (decision.kind === 'redirect') {
    return NextResponse.redirect(new URL(decision.to, request.url))
  }

  if (isApi(pathname)) {
    return NextResponse.json(
      { error: decision.status === 403 ? 'Forbidden' : 'Unauthorized' },
      { status: decision.status },
    )
  }

  const url = request.nextUrl.clone()
  url.pathname = LOGIN_PATH
  url.search = ''
  url.searchParams.set('redirectTo', `${pathname}${search}`)
  return NextResponse.redirect(url)
}

/**
 * Configuration is missing or the auth backend is unreachable, so this request
 * cannot be authorized. Fail closed: nothing is served rather than serving it
 * ungated.
 *
 * The requested path is deliberately not echoed into the page — it is
 * attacker-controlled, and it tells the reader nothing they do not already
 * know from the address bar.
 */
export function unavailableResponse(request: NextRequest): NextResponse {
  if (isApi(request.nextUrl.pathname)) {
    return NextResponse.json({ error: 'Service Unavailable' }, { status: 503 })
  }

  return new NextResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Workbench temporarily unavailable</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center;
             font-family: system-ui, sans-serif; background: #09090b; color: #fafafb; }
      main { max-width: 32rem; padding: 2rem; text-align: center; }
      p { color: #a1a1aa; }
    </style>
  </head>
  <body>
    <main>
      <h1>The Workbench is temporarily unavailable</h1>
      <p>We could not verify your sign-in just now, so nothing is being shown. Please try again shortly.</p>
    </main>
  </body>
</html>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}
