import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

const MIGRATION = 'supabase/migrations/20261012000000_drop_crm_opportunity_mirror.sql'

describe('dropping the CRM opportunity mirror', () => {
  it('rewrites the trigger functions before the column they name disappears', () => {
    const migration = read(MIGRATION)

    // This is the real blast radius: both functions list `opportunity_id` in
    // their INSERT column lists. plpgsql resolves columns at execution, so
    // leaving them alone would not fail the migration — it would fail every
    // client_intake and lead_activity write afterwards.
    expect(migration).toContain('create or replace function public.sync_crm_person_from_intake()')
    expect(migration).toContain('create or replace function public.sync_crm_activity_from_lead_activity()')
    const functionsEnd = migration.lastIndexOf('revoke all on function public.sync_crm_activity_from_lead_activity()')
    expect(functionsEnd).toBeGreaterThan(-1)
    expect(migration.indexOf('drop column if exists opportunity_id')).toBeGreaterThan(functionsEnd)

    // Neither rewritten body may still name the column.
    const bodies = migration.slice(
      migration.indexOf('create or replace function public.sync_crm_person_from_intake()'),
      functionsEnd,
    )
    expect(bodies).not.toContain('opportunity_id')
  })

  it('drops the cascading FK before the column, and the column before the table', () => {
    const migration = read(MIGRATION)

    const fk = migration.indexOf('drop constraint if exists cornerstone_crm_activities_opportunity_id_fkey')
    const column = migration.indexOf('drop column if exists opportunity_id')
    const table = migration.indexOf('drop table if exists public.cornerstone_crm_opportunities')

    expect(fk).toBeGreaterThan(-1)
    expect(column).toBeGreaterThan(fk)
    expect(table).toBeGreaterThan(column)
  })

  it('replaces the invariant that died with the column', () => {
    const migration = read(MIGRATION)

    // The old CHECK was `person_id is not null or opportunity_id is not null`,
    // and Postgres drops any constraint involving a dropped column. Without
    // this, nothing would require an activity to identify anyone at all.
    expect(migration).toContain('alter column person_id set not null')
  })

  it('drops the table without CASCADE', () => {
    const migration = read(MIGRATION)

    // Everything known to depend on it is removed first, so anything still
    // attached is unaccounted for and should fail loudly.
    expect(migration).toContain('drop table if exists public.cornerstone_crm_opportunities;')
    expect(migration).not.toMatch(/drop table[^\n;]*cornerstone_crm_opportunities[^\n;]*cascade/i)
  })

  it('rebuilds the parity view without the opportunities arm, keeping the rest', () => {
    const migration = read(MIGRATION)

    // A bare `drop table ... cascade` would take the whole view — all four arms,
    // three of which have nothing to do with the mirror.
    expect(migration).toContain('create or replace view public.v_cornerstone_crm_parity')
    expect(migration).toContain("select 'intake_people'::text as entity")
    expect(migration).toContain("select 'contact_people'")
    expect(migration).toContain("select 'activities'")
    expect(migration).not.toContain("select 'opportunities'")
    expect(migration).toContain('grant select on public.v_cornerstone_crm_parity to authenticated, service_role')
  })

  it('clears the outbox rows that now point at nothing', () => {
    const migration = read(MIGRATION)

    expect(migration).toContain("delete from public.cornerstone_crm_sync_events where entity_type = 'opportunity'")
    expect(migration).toContain("notify pgrst, 'reload schema'")
  })

  it('leaves no application reference to the dropped table or column', () => {
    expect(read('lib/queries/crmHub.ts')).not.toMatch(/from\(['"]cornerstone_crm_opportunities/)
    expect(read('lib/queries/crmHub.ts')).not.toMatch(/select\([^)]*opportunity_id/)
  })
})
