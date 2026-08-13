import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { PRACTICE_AREA_OPTIONS } from '@/lib/practiceArea'

/**
 * Practice area is validated in the database as well as in TypeScript, and in
 * more places than one: a CHECK constraint, a BEFORE-write trigger shared by
 * `client_intake` and `matter_details`, the leads UI RPC, and the lead-to-matter
 * conversion. Adding a practice area to `PRACTICE_AREA_OPTIONS` without widening
 * all four ships a code path the database rejects at runtime — which is exactly
 * how `CP` failed its own backfill with `Invalid practice area: CP`.
 *
 * These tests read the *latest* definition of each SQL site (later migrations
 * replace earlier ones) and assert every option the app offers is accepted.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase/migrations')

function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort()
}

/** The last migration whose text matches, i.e. the definition currently live. */
function latestMatching(pattern: RegExp): { file: string; sql: string } {
  const matches = migrationFiles().filter(name =>
    pattern.test(fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')),
  )
  const file = matches[matches.length - 1]
  expect(file, `no migration defines ${pattern}`).toBeTruthy()
  return { file, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8') }
}

const CODES = PRACTICE_AREA_OPTIONS.map(option => option.value)

describe('practice area parity between the app and the database', () => {
  it('offers the codes the CHECK constraint allows', () => {
    const { sql } = latestMatching(/matter_details_practice_area_check\s*\n?\s*CHECK/i)
    const allowed = sql.match(/practice_area IN \(([^)]+)\)/i)?.[1] ?? ''

    for (const code of CODES) {
      expect(allowed, `CHECK constraint rejects ${code}`).toContain(`'${code}'`)
    }
  })

  it('offers the codes the shared normalize trigger accepts', () => {
    const { sql } = latestMatching(/create or replace function public\.normalize_shared_practice_area/)
    const body = sql.slice(sql.indexOf('normalize_shared_practice_area'))
    const fn = body.slice(0, body.indexOf('$$;'))

    for (const code of CODES) {
      // The trigger assigns the canonical code in the branch that accepts it.
      expect(fn, `normalize_shared_practice_area rejects ${code}`)
        .toContain(`:= '${code}'`)
    }
  })

  it('offers the codes the leads field RPC accepts', () => {
    const { sql } = latestMatching(/p_field = 'practiceArea' and v_text is not null/)
    const allowed = sql.match(/v_text not in \(([^)]+)\)/)?.[1] ?? ''

    for (const code of CODES) {
      expect(allowed, `update_lead_opportunity_field rejects ${code}`).toContain(`'${code}'`)
    }
  })

  it('carries every code through lead-to-matter conversion', () => {
    const { sql } = latestMatching(/create or replace function public\.convert_lead_to_matter/)
    const start = sql.indexOf('v_practice_area := case')
    const caseBlock = sql.slice(start, sql.indexOf('end;', start))

    // 'EP' is the else fallback rather than its own branch; every other code
    // needs one, or conversion silently downgrades the matter to EP.
    for (const code of CODES.filter(value => value !== 'EP')) {
      expect(caseBlock, `convert_lead_to_matter drops ${code} on conversion`)
        .toContain(`'${code}'`)
    }
  })
})
