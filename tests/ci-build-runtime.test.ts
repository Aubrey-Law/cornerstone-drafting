import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const temporary: string[] = []
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function buildProbe(dotenv = false) {
  const cwd = mkdtempSync(join(tmpdir(), 'firm-ci-build-'))
  temporary.push(cwd)
  const bin = join(cwd, 'bin')
  mkdirSync(bin)
  // Stand in for npm so this exercises the real launcher and child runtime
  // without compiling the app or reading any application configuration.
  writeFileSync(join(bin, 'npm'), `#!${process.execPath}\n` + `
const { getHeapStatistics } = require('node:v8')
console.log(JSON.stringify({
  heapMiB: getHeapStatistics().heap_size_limit / 1024 / 1024,
  options: process.env.NODE_OPTIONS,
  secret: process.env.CI_PROBE_SECRET,
  database: process.env.NEXT_PUBLIC_SUPABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
}))
`, { mode: 0o755 })
  if (dotenv) writeFileSync(join(cwd, '.env.local'), 'CI_PROBE_SECRET=synthetic-do-not-load\n')
  return spawnSync(process.execPath, [resolve('scripts/ciBuild.mjs')], {
    cwd, encoding: 'utf8', env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      NODE_ENV: 'test',
      NODE_OPTIONS: '--max-old-space-size=128',
      CI_PROBE_SECRET: 'synthetic-do-not-forward',
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic-do-not-forward',
    },
  })
}

it('gives build workers a fixed 4 GiB heap without inheriting arbitrary Node options', () => {
  const result = buildProbe()
  expect(result.status, result.stderr).toBe(0)
  const probe = JSON.parse(result.stdout)
  expect(probe.options).toBe('--max-old-space-size=4096')
  expect(probe.heapMiB).toBeGreaterThanOrEqual(4096)
  expect(probe.heapMiB).toBeLessThan(4352)
  expect(probe.secret).toBeUndefined()
  expect(probe.database).toBe('http://127.0.0.1:9')
  expect(probe.serviceKey).toBe('build-only-service-role-key')
})

it('still rejects local dotenv files before launching the build', () => {
  const result = buildProbe(true)
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('requires a clean checkout')
  expect(result.stdout).toBe('')
})
