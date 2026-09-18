import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * The intake lock has to be enforced by the database, not by a route.
 *
 * `client_intake_update_own` granted a signed-in client unrestricted UPDATE on
 * their own row. The anon key ships in the browser bundle and the client holds
 * their own portal JWT, so they could PATCH the row through PostgREST and
 * reopen a questionnaire the attorney had already received — the "Intake is
 * locked" check in app/api/intake/route.ts never ran.
 * 20261209000000_client_intake_writes_service_role_only.sql dropped it, and
 * client_intake_insert_own with it.
 *
 * tests/integration/schema/client-intake-rls.test.ts proves the behaviour
 * against the real migrated database. This one is the cheap always-on half: it
 * reads the migration set the way Postgres will and fails fast, in the main
 * suite, if a later migration hands the write back.
 */

const MIGRATIONS = path.join(process.cwd(), 'supabase', 'migrations')

/** Every CREATE POLICY / DROP POLICY on client_intake, in migration order. */
function policyStatements() {
  const statements: Array<{ file: string; action: 'create' | 'drop'; name: string; body: string }> = []

  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    // Comments first: these migrations quote the policy they are removing, and
    // a guard that reads prose fails on the explanation rather than the change.
    const sql = readFileSync(path.join(MIGRATIONS, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*--.*$/gm, '')

    for (const match of sql.matchAll(
      /\b(create|drop)\s+policy\s+(?:if\s+(?:not\s+)?exists\s+)?"?([^"\s]+)"?([\s\S]*?);/gi,
    )) {
      const [, verb, name, rest] = match
      // The table the policy is ON, not any mention of the name. Policies on
      // other tables reference client_intake inside a USING subquery, and
      // matching those was this guard's first, wrong answer.
      const target = /\bon\s+(?:public\.)?"?([A-Za-z_][\w$]*)"?/i.exec(rest)?.[1]
      if (target !== 'client_intake') continue
      statements.push({
        file,
        action: verb.toLowerCase() as 'create' | 'drop',
        name,
        body: rest,
      })
    }
  }
  return statements
}

/** The policies still standing once the whole migration set has been applied. */
function livePolicies() {
  const live = new Map<string, string>()
  for (const s of policyStatements()) {
    if (s.action === 'drop') live.delete(s.name)
    else live.set(s.name, s.body)
  }
  return live
}

describe('client_intake write policies', () => {
  it('finds the policies it is meant to be reading', () => {
    // Without this the regex could quietly match nothing and every assertion
    // below would pass over an empty set.
    expect([...livePolicies().keys()]).toContain('client_intake_select_own')
  })

  it('grants clients no write of their own row', () => {
    const offenders = [...livePolicies()].filter(([name, body]) => {
      if (name === 'attorneys_all_client_intake') return false
      // A client-scoped policy is one keyed on the caller's own id. The
      // attorney policy is keyed on a role lookup in public.users instead.
      const clientScoped = /auth\.uid\(\)/.test(body)
      const writes = /\bfor\s+(update|insert|delete|all)\b/i.test(body)
      return clientScoped && writes
    })

    expect(
      offenders.map(([name]) => name),
      'client_intake writes must go through the service role — see 20261209000000',
    ).toEqual([])
  })

  it('keeps the client read, which is what proves ownership in the portal', () => {
    // lib/portal/getMatterForUser.ts resolves the matter from an intake row the
    // user read under RLS. Dropping SELECT would break every portal page.
    const select = livePolicies().get('client_intake_select_own')
    expect(select).toBeDefined()
    expect(select).toMatch(/for\s+select/i)
  })
})
