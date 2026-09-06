import { describe, expect, it } from 'vitest'
import { REQUIRED_SERVER_ENV, checkEnv, assertDeployEnv } from '../lib/env'

const complete: Record<string, string> = Object.fromEntries(
  REQUIRED_SERVER_ENV.map((name) => [name, `value-for-${name}`]),
)

describe('workbench environment validation', () => {
  it('requires CRON_SECRET, so the tick route cannot silently run unauthenticated', () => {
    // The other assertions below all derive their expectations from
    // `REQUIRED_SERVER_ENV` itself, so they would pass unchanged no matter
    // what the list contained — this is the one that actually pins down that
    // the tick route's secret (`app/api/cron/tick/route.ts`) is on it.
    expect(REQUIRED_SERVER_ENV).toContain('CRON_SECRET')
  })

  it('names every missing required variable at once', () => {
    const result = checkEnv({})
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual([...REQUIRED_SERVER_ENV])
  })

  it('treats a blank value as missing', () => {
    const result = checkEnv({ ...complete, [REQUIRED_SERVER_ENV[0]]: '   ' })
    expect(result.missing).toEqual([REQUIRED_SERVER_ENV[0]])
  })

  it('passes a complete environment', () => {
    expect(checkEnv(complete)).toEqual({ ok: true, missing: [] })
  })

  it('fails a deploy build that is missing variables, naming them', () => {
    expect(() => assertDeployEnv({ VERCEL: '1' })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('lets a local build proceed with a warning instead of failing', () => {
    const warnings: string[] = []
    expect(() => assertDeployEnv({}, (msg) => warnings.push(msg))).not.toThrow()
    expect(warnings.join('\n')).toMatch(/NEXT_PUBLIC_SUPABASE_URL/)
  })
})
