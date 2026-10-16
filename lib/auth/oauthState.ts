import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { NextRequest, NextResponse } from 'next/server'

/**
 * Binds a calendar OAuth round-trip to the browser and staff user that began it.
 *
 * `state` travels through the provider and back as plain query text, so on its
 * own it proves nothing: anyone can build a consent URL with our public client
 * id and any `state` they like. The connect route therefore also sets a
 * short-lived httpOnly cookie holding a random nonce and the staff user's id,
 * and the callback stores tokens only when the `state` nonce matches that
 * cookie and the cookie's user is the one signed in. That stops a forged or
 * replayed callback from attaching someone else's account to a staff user
 * (login CSRF), and stops a grant from landing on a user other than the one who
 * clicked Connect.
 */

export type OAuthProvider = 'google' | 'microsoft'

const MAX_AGE_SECONDS = 10 * 60

function cookieName(provider: OAuthProvider): string {
  return `cs_oauth_${provider}`
}

function cookiePath(provider: OAuthProvider): string {
  return `/api/admin/${provider}/callback`
}

function cookieOptions(provider: OAuthProvider, maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Lax still sends the cookie on the provider's top-level redirect back.
    sameSite: 'lax' as const,
    path: cookiePath(provider),
    maxAge,
  }
}

interface StatePayload {
  n: string
  returnTo?: string
}

/**
 * Mint `state` for the consent URL, plus `withCookie`, which sets the matching
 * cookie on the redirect response.
 */
export function beginOAuthState(
  provider: OAuthProvider,
  userId: string,
  returnTo: string,
): { state: string; withCookie: (res: NextResponse) => NextResponse } {
  const nonce = randomBytes(32).toString('base64url')
  const payload: StatePayload = { n: nonce, returnTo }
  return {
    state: Buffer.from(JSON.stringify(payload)).toString('base64url'),
    withCookie: res => {
      res.cookies.set(cookieName(provider), `${nonce}.${userId}`, cookieOptions(provider, MAX_AGE_SECONDS))
      return res
    },
  }
}

/** The returnTo carried in `state`. Unverified: validate it before redirecting. */
export function stateReturnTo(state: string | null): string | undefined {
  const payload = decodeState(state)
  return typeof payload?.returnTo === 'string' ? payload.returnTo : undefined
}

/**
 * The staff user id this callback belongs to, or null when `state` does not
 * match this browser's cookie (missing, expired, forged, or another browser).
 */
export function verifyOAuthState(req: NextRequest, provider: OAuthProvider, state: string | null): string | null {
  const payload = decodeState(state)
  const cookie = req.cookies?.get(cookieName(provider))?.value
  if (!payload?.n || !cookie) return null
  const dot = cookie.indexOf('.')
  if (dot <= 0) return null
  const nonce = cookie.slice(0, dot)
  const userId = cookie.slice(dot + 1)
  if (!userId || !safeEqual(nonce, payload.n)) return null
  return userId
}

/** The nonce is single-use: clear it on every callback response. */
export function clearOAuthState(res: NextResponse, provider: OAuthProvider): NextResponse {
  res.cookies.set(cookieName(provider), '', cookieOptions(provider, 0))
  return res
}

function decodeState(state: string | null): Partial<StatePayload> | null {
  if (!state) return null
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Partial<StatePayload>) : null
  } catch {
    return null
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
