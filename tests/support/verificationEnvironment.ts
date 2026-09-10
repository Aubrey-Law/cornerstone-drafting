type Environment = Record<string, string | undefined>

// Preserve runner/OS settings, never app credentials. Tests install their own
// synthetic provider keys after setup when a scenario needs them.
export function unitEnvironment(source: Environment): Environment {
  const env: Environment = {}
  for (const key of ['PATH', 'HOME', 'USER', 'TMPDIR', 'TEMP', 'TMP', 'TERM', 'CI', 'NODE_ENV', 'NODE_OPTIONS', 'FORCE_COLOR', 'NO_COLOR']) {
    if (source[key] !== undefined) env[key] = source[key]
  }
  for (const [key, value] of Object.entries(source)) {
    if (/^(VITEST_|TINYPOOL_)/.test(key) || key === 'VITEST') env[key] = value
  }
  return {
    ...env,
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  }
}

export function integrationEnvironment(source: Environment): Environment {
  const url = source.INTEGRATION_SUPABASE_URL
  const key = source.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('INTEGRATION_SUPABASE_URL and INTEGRATION_SUPABASE_SERVICE_ROLE_KEY are required')
  const target = new URL(url)
  if (!['http:', 'https:'].includes(target.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
    || target.username || target.password || target.search || target.hash
    || target.pathname !== '/') {
    throw new Error('Integration tests require a loopback Supabase URL')
  }
  if (source.INTEGRATION_DATABASE_URL) {
    const database = new URL(source.INTEGRATION_DATABASE_URL)
    if (!['postgres:', 'postgresql:'].includes(database.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)) {
      throw new Error('Integration database must be loopback')
    }
  }
  return {
    ...unitEnvironment(source),
    INTEGRATION_DATABASE_URL: source.INTEGRATION_DATABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: target.origin,
    SUPABASE_SERVICE_ROLE_KEY: key,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: source.INTEGRATION_SUPABASE_ANON_KEY,
  }
}

export function replaceEnvironment(next: Environment) {
  for (const key of Object.keys(process.env)) delete process.env[key]
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) process.env[key] = value
  }
}
