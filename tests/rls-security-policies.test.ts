import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Static guards for three RLS holes that were exploitable from any signed-in
 * portal account. These assert on migration SQL rather than a live database, so
 * they are a regression tripwire, not a substitute for running the cross-tenant
 * checks against a scratch project before deploying.
 *
 * Why RLS is the whole boundary here: supabase/seed.sql grants
 * SELECT/INSERT/UPDATE/DELETE on all tables in `public` to `authenticated` (and
 * SELECT to `anon`), matching Supabase's cloud defaults. A table with RLS
 * disabled, or with an `auth.uid() IS NOT NULL` policy, is therefore readable
 * and writable by every logged-in user.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase/migrations')

function allMigrationSql(): string {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort()
    .map(name => fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8'))
    .join('\n')
    // Strip `--` line comments so statement-terminating `;` matching below is
    // not fooled by a semicolon inside explanatory prose.
    .replace(/--[^\n]*/g, '')
}

/** Statements that survive, i.e. are not dropped by a later migration. */
function effectivePolicies(sql: string, table: string): string[] {
  const created = [...sql.matchAll(/CREATE POLICY\s+"([^"]+)"\s*\n?\s*ON public\.(\w+)/g)]
    .filter(match => match[2] === table)
    .map(match => match[1])
  const dropped = new Set(
    [...sql.matchAll(/DROP POLICY(?: IF EXISTS)?\s+"([^"]+)"\s+ON public\.(\w+)/g)]
      .filter(match => match[2] === table)
      .map(match => match[1]),
  )
  return created.filter(name => !dropped.has(name))
}

const STAFF_ROLE_CHECK = /u\.role IN \('attorney', 'admin'/

describe('users.role privilege escalation', () => {
  const sql = allMigrationSql()

  it('the surviving self-update policy pins the role column', () => {
    // Before: WITH CHECK (id = auth.uid()) — any user could PATCH their own row
    // to role='admin' via PostgREST with the public anon key and pass every
    // requireAdmin / proxy.ts / staff RLS check.
    const updatePolicy = /CREATE POLICY "users_update_own"[\s\S]*?;/g
    const surviving = [...sql.matchAll(updatePolicy)].at(-1)?.[0] ?? ''

    expect(surviving).toContain('FOR UPDATE')
    expect(surviving).toMatch(/role = \(SELECT u\.role FROM public\.users u WHERE u\.id = auth\.uid\(\)\)/)
  })

  it('the surviving self-insert policy cannot choose a privileged role', () => {
    const insertPolicy = /CREATE POLICY "users_insert_own"[\s\S]*?;/g
    const surviving = [...sql.matchAll(insertPolicy)].at(-1)?.[0] ?? ''

    expect(surviving).toContain("role = 'client'")
  })

  it('staff bootstrap derives the role server-side, not from client input', () => {
    // The tightened insert policy means role assignment must happen in a
    // SECURITY DEFINER function that reads the verified email.
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.ensure_user_profile/)
    expect(sql).toMatch(/SECURITY DEFINER\s*\n?\s*SET search_path = ''/)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.ensure_user_profile\(text\) FROM PUBLIC, anon/)
  })
})

describe('matter_activity tenant isolation', () => {
  const sql = allMigrationSql()

  it('no surviving policy admits any authenticated user', () => {
    // lib/sms/inbound.ts stores full inbound SMS bodies in metadata, so an
    // `auth.uid() IS NOT NULL` policy leaked one client's messages to all others.
    const surviving = effectivePolicies(sql, 'matter_activity')
    expect(surviving).not.toContain('authenticated_select_matter_activity')
    expect(surviving).not.toContain('authenticated_insert_matter_activity')
    expect(surviving.length).toBeGreaterThan(0)
  })

  it('surviving policies are scoped to staff roles', () => {
    const blocks = [...sql.matchAll(/CREATE POLICY\s+"([^"]+)"\s*\n?\s*ON public\.matter_activity[\s\S]*?;/g)]
      .filter(block => effectivePolicies(sql, 'matter_activity').includes(block[1]))

    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) {
      expect(block[0]).toMatch(STAFF_ROLE_CHECK)
    }
  })
})

describe('firm_holidays', () => {
  const sql = allMigrationSql()

  it('has RLS enabled', () => {
    // business_days_elapsed() subtracts these dates, so a client-inserted row
    // silently suppressed every SLA/aging overdue calculation.
    expect(sql).toMatch(/ALTER TABLE public\.firm_holidays ENABLE ROW LEVEL SECURITY/)
  })

  it('revokes the default authenticated write grants', () => {
    expect(sql).toMatch(/REVOKE ALL ON public\.firm_holidays FROM PUBLIC, anon, authenticated/)
  })
})

describe('every table created in migrations enables RLS', () => {
  it('leaves no table without row level security', () => {
    const sql = allMigrationSql()
    const created = new Set(
      [...sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? public\.(\w+)/g)].map(m => m[1]),
    )
    const rlsEnabled = new Set(
      [...sql.matchAll(/ALTER TABLE public\.(\w+) ENABLE ROW LEVEL SECURITY/g)].map(m => m[1]),
    )

    const missing = [...created].filter(table => !rlsEnabled.has(table)).sort()
    expect(missing).toEqual([])
  })
})
