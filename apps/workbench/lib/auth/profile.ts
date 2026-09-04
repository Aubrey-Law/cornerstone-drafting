/**
 * Turning a first sign-in into an account with a role.
 *
 * A Google sign-in arrives with an auth identity and no `users` row, so it has
 * no role — and the gate denies a roleless session everywhere. This is what
 * resolves that, once.
 *
 * The role is never chosen here, and could not be. The store's `createProfile`
 * calls a SECURITY DEFINER function that reads the confirmed address off
 * `auth.users`, so a caller cannot ask to be an attorney; row-level security
 * forbids inserting anything but a client row directly. The display name is
 * the only thing the client contributes.
 *
 * Two injected functions rather than a Supabase client, for the same reason as
 * `resolveRole` in ./session: asking TypeScript to match a Supabase client
 * against a structural interface is a comparison deep enough that it gives up
 * (TS2589). The queries live in lib/supabase/profile.ts.
 */

export interface ProfileStore {
  readRole: () => PromiseLike<string | null>
  createProfile: (fullName: string | null) => PromiseLike<{ ok: boolean; role: string | null }>
}

export async function ensureUserProfile(
  store: ProfileStore,
  identity: { fullName: string | null },
): Promise<string | null> {
  const existing = await store.readRole()
  if (existing) return existing

  const created = await store.createProfile(identity.fullName)
  // Two callbacks racing a first sign-in both find no row and both insert; one
  // loses on the primary key. Re-reading turns that into the role that now
  // exists rather than a failed sign-in.
  if (!created.ok) return store.readRole()

  return created.role
}
