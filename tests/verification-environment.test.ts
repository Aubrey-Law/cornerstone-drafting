import { describe, expect, it } from 'vitest'
import { integrationEnvironment, unitEnvironment } from './support/verificationEnvironment'

describe('verification credentials', () => {
  it('unit tests discard inherited service credentials and use a closed local endpoint', () => {
    const env = unitEnvironment({ PATH: '/usr/bin', SUPABASE_SERVICE_ROLE_KEY: 'live', RESEND_API_KEY: 'live', CUSTOM_SECRET: 'live' })
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('test-service-role-key')
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:9')
    expect(env.RESEND_API_KEY).toBeUndefined()
    expect(env.CUSTOM_SECRET).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
  })

  it.each(['https://qifunlovuwaryzsyfbnh.supabase.co', 'https://unapproved.supabase.co', 'http://localhost.attacker.test', 'http://user:pass@localhost:54321', 'file:///tmp/db'])('rejects an integration target before constructing clients: %s', url => {
    expect(() => integrationEnvironment({ INTEGRATION_SUPABASE_URL: url, INTEGRATION_SUPABASE_SERVICE_ROLE_KEY: 'test-key' })).toThrow()
  })

  it('requires explicit integration credentials and only accepts loopback', () => {
    expect(() => integrationEnvironment({})).toThrow(/INTEGRATION_SUPABASE/)
    expect(integrationEnvironment({
      INTEGRATION_SUPABASE_URL: 'http://127.0.0.1:54321',
      INTEGRATION_SUPABASE_SERVICE_ROLE_KEY: 'local-service',
      INTEGRATION_SUPABASE_ANON_KEY: 'local-anon',
    })).toMatchObject({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'local-service',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon',
    })
  })
})
