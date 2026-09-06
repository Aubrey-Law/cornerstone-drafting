import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const script = fs.readFileSync(
  path.resolve(__dirname, '../../../scripts/checkDbRpcs.mjs'),
  'utf8',
)

describe('the RPC checker’s reach', () => {
  it('looks at the workbench, not only the root app', () => {
    // apps/workbench/lib/supabase/profile.ts calls ensure_user_profile on the
    // sign-in path, and until this the checker never saw it. A dropped or
    // renamed function would have broken sign-in in production with nothing
    // catching it first — which is the outage this workflow was written after.
    expect(script).toContain('apps/workbench')
  })

  it('still looks at the root app', () => {
    for (const dir of ['app', 'lib', 'components']) {
      expect(script).toMatch(new RegExp(`'${dir}'`))
    }
  })
})
