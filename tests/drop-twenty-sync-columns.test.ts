import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

const MIGRATION = 'supabase/migrations/20261013000000_drop_twenty_sync_columns.sql'

describe('dropping the Twenty sync columns', () => {
  it('rewrites both person-sync triggers before the column they name disappears', () => {
    const migration = read(MIGRATION)

    // Same trap as the mirror drop: plpgsql resolves columns at execution, so
    // leaving `sync_state` in these INSERT lists would not fail the migration —
    // it would fail every client_intake and every contacts write afterwards.
    const intake = migration.indexOf('create or replace function public.sync_crm_person_from_intake()')
    const contact = migration.indexOf('create or replace function public.sync_crm_person_from_contact()')
    const drop = migration.indexOf('drop column if exists sync_state')

    expect(intake).toBeGreaterThan(-1)
    expect(contact).toBeGreaterThan(-1)
    expect(drop).toBeGreaterThan(intake)
    expect(drop).toBeGreaterThan(contact)

    // Neither rewritten body may still name it. Sliced to the function bodies
    // themselves — the prose further down legitimately mentions the column.
    for (const start of [intake, contact]) {
      const body = migration.slice(start, migration.indexOf('\n$$;', start))
      expect(body).not.toContain('sync_state')
    }
  })

  it('drops the view rather than replacing it, since a replace cannot remove columns', () => {
    const migration = read(MIGRATION)

    expect(migration).toContain('drop view if exists public.v_cornerstone_crm_people')
    expect(migration).toContain('create view public.v_cornerstone_crm_people')
    expect(migration).not.toContain('create or replace view public.v_cornerstone_crm_people')
    expect(migration).toContain('grant select on public.v_cornerstone_crm_people to authenticated, service_role')
  })

  it('rebuilds the view without the dead columns and keeps the rest', () => {
    const migration = read(MIGRATION)
    const view = migration.slice(migration.indexOf('create view public.v_cornerstone_crm_people'))

    expect(view).not.toContain('p.sync_state')
    expect(view).not.toContain('p.twenty_contact_id')
    // The columns that carry the CRM people page are still there.
    expect(view).toContain('p.person_kind')
    expect(view).toContain('p.client_intake_id')
    expect(view).toContain('p.lifecycle_status')
    expect(view).toContain('ci.matter_id as cornerstone_matter_id')
  })

  it('drops all four columns', () => {
    const migration = read(MIGRATION)

    for (const column of ['twenty_contact_id', 'twenty_company_id', 'last_synced_at', 'sync_state']) {
      expect(migration).toContain(`drop column if exists ${column}`)
    }
    expect(migration).toContain("notify pgrst, 'reload schema'")
  })

  it('leaves the outbox table alone', () => {
    const migration = read(MIGRATION)

    // cornerstone_crm_sync_events is the outbox itself, not a Twenty artefact:
    // it still records people and activity events and the sync page reads it.
    expect(migration).not.toMatch(/drop table[^\n;]*cornerstone_crm_sync_events/i)
  })

  it('leaves no application reference to the dropped columns', () => {
    const source = read('lib/queries/cornerstoneCrm.ts')

    expect(source).not.toContain('sync_state')
    expect(source).not.toContain('syncState')
    expect(source).not.toContain('twenty_contact_id')
    expect(source).not.toContain('twentyContactId')
    expect(source).not.toContain('last_synced_at')
    expect(source).not.toContain('lastSyncedAt')
  })
})
