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
      error?: { message: string } | null
    }>
  }
}

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
 */
export async function resolveSession(client: ClaimsReadingClient): Promise<SessionResult> {
  try {
    const { data, error } = await client.auth.getClaims()
    if (error) return { ok: false }
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
