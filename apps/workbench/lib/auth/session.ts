/**
 * Reading who is asking, and failing closed when that cannot be determined.
 *
 * Both functions take a structural client rather than a Supabase instance —
 * the same injection idiom as the drafting engine's clause client — so the
 * branching here is testable with plain objects and no module mocking.
 */

export type AuthClaims = Record<string, unknown>

export type ClaimsReadingClient = {
  auth: {
    getClaims: () => PromiseLike<{
      data?: { claims?: AuthClaims } | null
      error?: { message: string; code?: string; status?: number } | null
    }>
  }
}

/**
 * The error codes Supabase returns when it has read the token and judged it
 * unusable — as opposed to failing to answer at all.
 *
 * Measured against the live project on 2026-09-09: a JWT whose `kid` is absent
 * from the project's JWKS — what a token signed before a key rotation looks
 * like — returns `bad_jwt` with status 403. So does a string that is not a JWT
 * at all; `bad_jwt` is the only code this project was observed to return.
 *
 * `invalid_jwt` is carried as a documented Supabase code that means the same
 * thing, **not** as something reproduced here. It costs nothing as a superset,
 * but it is not evidence, and the test that covers it says so.
 *
 * Matching on the code rather than on "any 4xx" is deliberate — a 429 or a
 * misconfiguration is also a 4xx, and neither is a reason to sign someone
 * out.
 */
const UNUSABLE_TOKEN_CODES = new Set(['bad_jwt', 'invalid_jwt'])

/**
 * Reads the role recorded against a user, or null when there is none.
 *
 * A function rather than a client, so the policy below stays independent of
 * where the answer comes from — and so TypeScript is not asked to match a
 * Supabase client against a structural interface, a comparison deep enough
 * that it gives up (TS2589). The query itself lives in
 * `lib/supabase/roles.ts`.
 */
export type RoleReader = (userId: string) => PromiseLike<string | null>

export type SessionResult =
  | { ok: true; userId: string | null; claimRole: string | null }
  /** The auth backend could not be reached. The caller answers 503. */
  | { ok: false }

/**
 * `getClaims()` verifies the JWT locally, so this is normally free of a network
 * hop; it can still fail when the signing keys have to be fetched.
 *
 * An unreachable auth backend is not an anonymous request. Reading a failure as
 * "no session" would send every signed-in request to the login page during an
 * outage, and reading it as "no gate" would serve one client's documents to
 * anyone who asked. It fails closed and the proxy answers 503.
 *
 * **An unusable token is not an outage either, and that distinction is load
 * bearing.** When Supabase answers `bad_jwt`, it was reachable, it read the
 * token, and it judged it — the one thing that is certainly *not* wrong is the
 * backend. Failing closed there produces a 503 on every path including
 * `/auth/login`, which is behind this same gate: the holder of a stale cookie
 * cannot reach the page that would replace it, and is locked out until they
 * clear cookies by hand, with nothing on screen to suggest that. Reproduced
 * against the deployed workbench on 2026-09-09 with a token whose signing key
 * had been rotated away.
 *
 * So a token the backend has judged unusable is treated as no session at all,
 * and the visitor is sent to the login page to get a new one. Everything else —
 * a 5xx, a fetch that never landed, an error with no code — still fails closed.
 */
export async function resolveSession(client: ClaimsReadingClient): Promise<SessionResult> {
  try {
    const { data, error } = await client.auth.getClaims()
    if (error) {
      return error.code && UNUSABLE_TOKEN_CODES.has(error.code)
        ? { ok: true, userId: null, claimRole: null }
        : { ok: false }
    }
    const claims = data?.claims
    const sub = typeof claims?.sub === 'string' ? claims.sub : null
    const claimRole = typeof claims?.user_role === 'string' ? claims.user_role : null
    return { ok: true, userId: sub, claimRole }
  } catch {
    return { ok: false }
  }
}

/**
 * Prefer the `user_role` JWT claim; fall back to the `users` table.
 *
 * The fallback is not belt-and-braces. The custom access-token hook that
 * populates the claim is not enabled in local development, and sessions issued
 * before it was enabled carry no claim — without the query every one of them
 * reads as roleless and gets denied.
 */
export async function resolveRole(
  readRole: RoleReader,
  userId: string,
  claimRole: string | null | undefined,
): Promise<string | null> {
  if (claimRole) return claimRole
  return (await readRole(userId)) ?? null
}
