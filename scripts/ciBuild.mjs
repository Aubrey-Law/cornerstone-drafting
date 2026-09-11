import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// Next automatically reads these files even when the parent environment is
// clean. CI builds must not accidentally acquire local production credentials.
const localEnv = ['.env', '.env.local', '.env.production', '.env.production.local'].find(existsSync)
if (localEnv) {
  console.error(`build:ci requires a clean checkout without ${localEnv}; use npm run build for a configured local build.`)
  process.exit(1)
}
const env = {}
for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SYSTEMROOT', 'CI', 'TERM']) {
  if (process.env[key] !== undefined) env[key] = process.env[key]
}
Object.assign(env, {
  NODE_ENV: 'production',
  // Next's TypeScript worker inherits this environment. Node 22 on the CI
  // runner defaults to a ~2 GiB heap, which this app's type graph exceeds.
  // Set a known budget instead of forwarding arbitrary parent NODE_OPTIONS.
  NODE_OPTIONS: '--max-old-space-size=4096',
  NEXT_TELEMETRY_DISABLED: '1',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'build-only-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'build-only-service-role-key',
})
const child = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
  env,
  stdio: 'inherit',
})
if (child.error) console.error(child.error.message)
process.exit(child.status ?? 1)
