/**
 * Environment the workbench needs to run, checked in one place.
 *
 * The root app discovers a missing variable at the first request that needs
 * it, which is why it carries a hand-maintained deployment checklist. Here the
 * list is code: a deploy build fails with every missing name at once, a local
 * build warns and proceeds, and `/api/health?check=env` reports the same list
 * at runtime.
 *
 * Add a variable here when the code that reads it lands, in the same PR.
 */
export const REQUIRED_SERVER_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET',
] as const

export type RequiredServerEnv = (typeof REQUIRED_SERVER_ENV)[number]

type EnvSource = Record<string, string | undefined>

export function checkEnv(source: EnvSource): { ok: boolean; missing: RequiredServerEnv[] } {
  const missing = REQUIRED_SERVER_ENV.filter((name) => !source[name]?.trim())
  return { ok: missing.length === 0, missing }
}

/**
 * Build-time gate. On Vercel a failed build leaves the previous deployment
 * serving, so failing here is the safe direction; locally the same gap is a
 * warning because a checkout without `.env.local` should still build.
 */
export function assertDeployEnv(
  source: EnvSource,
  warn: (message: string) => void = (message) => console.warn(message),
): void {
  const { ok, missing } = checkEnv(source)
  if (ok) return
  const message =
    `Workbench environment is incomplete. Missing: ${missing.join(', ')}. ` +
    'Set these on the Vercel project (Settings → Environment Variables) — see lib/env.ts.'
  if (source.VERCEL === '1') throw new Error(message)
  warn(message)
}
