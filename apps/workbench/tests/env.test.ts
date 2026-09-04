import { describe, expect, it } from 'vitest'
import { REQUIRED_SERVER_ENV, checkEnv, assertDeployEnv } from '../lib/env'

const complete: Record<string, string> = Object.fromEntries(
  REQUIRED_SERVER_ENV.map((name) => [name, `value-for-${name}`]),
)

describe('workbench environment validation', () => {
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
