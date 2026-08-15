import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

const MIGRATION = 'supabase/migrations/20260929000000_merge_contacts.sql'
const ROUTE = 'app/api/admin/contacts/merge/route.ts'

describe('merging two rows that are the same person', () => {
  const migration = source(MIGRATION)

  it('tombstones the loser rather than deleting them', () => {
    // A bad merge is undone by clearing these two columns; a delete is not
    // undoable, and any link still pointing at the row would dangle.
    expect(migration).toMatch(/add column if not exists merged_into_id uuid references public\.contacts\(id\)/i)
    expect(migration).toMatch(/SET merged_into_id = p_winner_id,\s*merged_at = now\(\)/i)
    expect(migration).not.toMatch(/DELETE FROM public\.contacts/i)
  })

  it('records every merge in a log that outlives the rows', () => {
    expect(migration).toMatch(/create table if not exists public\.contact_merges/i)
    expect(migration).toMatch(/INSERT INTO public\.contact_merges/i)
    // Same no-foreign-key reasoning as matter_deletions.
    expect(migration).toMatch(/winner_contact_id uuid not null,\s*loser_contact_id uuid not null,/i)
  })

  it('refuses the merges that would corrupt the graph', () => {
    expect(migration).toMatch(/Cannot merge a contact into itself/i)
    expect(migration).toMatch(/has already been merged/i)
    expect(migration).toMatch(/has itself been merged away/i)
    expect(migration).toMatch(/RAISE EXCEPTION 'Service role required'/i)
  })

  it('drops the loser’s duplicate link instead of violating the join’s unique key', () => {
    expect(migration).toMatch(/DELETE FROM public\.matter_contacts loser_link[\s\S]{0,400}winner_link\.contact_id = p_winner_id/i)
  })

  it('collapses an identical appointment held by both', () => {
    expect(migration).toMatch(/DELETE FROM public\.contact_roles loser_role[\s\S]{0,500}winner_role\.priority = loser_role\.priority/i)
  })

  it('moves communications and drops the duplicated CRM mirror', () => {
    for (const table of ['sms_messages', 'calls']) {
      expect(migration).toMatch(new RegExp(`UPDATE public\\.${table} SET contact_id = p_winner_id`, 'i'))
    }
    // cornerstone_crm_people is unique on contact_id, so repointing would fail.
    expect(migration).toMatch(/DELETE FROM public\.cornerstone_crm_people WHERE contact_id = p_loser_id/i)
  })
})

describe('rewriting contact ids inside design sheets', () => {
  const migration = source(MIGRATION)

  it('replaces the id as an object KEY, not only as a value', () => {
    // fiduciary_contact_details and fiduciary_document_inclusions are keyed by
    // contact id. A value-only rewrite silently leaves the fiduciary's details
    // attached to a person who no longer exists — §8's trap.
    expect(migration).toMatch(/new_key := case when entry\.key = from_id then to_id else entry\.key end/i)
  })

  it('keeps the winner’s entry when both ids are keys of the same object', () => {
    expect(migration).toMatch(/if result \? new_key and entry\.key = from_id then\s*continue;/i)
  })

  it('recurses, so a nested reference is not missed', () => {
    expect(migration).toMatch(/when 'array' then[\s\S]{0,300}public\.jsonb_replace_id\(item, from_id, to_id\)/i)
  })

  it('discovers the jsonb columns rather than listing them', () => {
    // Ten slot columns plus decisions today; a column added later is covered
    // without anyone remembering this function exists.
    expect(migration).toMatch(/FROM information_schema\.columns[\s\S]{0,160}table_name = 'design_sheets' AND data_type = 'jsonb'/i)
  })

  it('counts sheets, not column writes', () => {
    // A sheet naming the loser in two columns is updated twice; reporting two
    // would read as a wider blast radius than the merge had.
    expect(migration).toMatch(/SELECT count\(DISTINCT s\) INTO v_sheets FROM unnest\(v_sheet_ids\)/i)
  })
})

describe('candidate detection', () => {
  const migration = source(MIGRATION)

  it('matches on exact email only', () => {
    expect(migration).toMatch(/loser\.email_key = winner\.email_key/i)
    expect(migration).toMatch(/lower\(btrim\(c\.email\)\) as email_key/i)
  })

  it('excludes tombstones and the deceased', () => {
    expect(migration).toMatch(/where c\.merged_into_id is null/i)
    expect(migration).toMatch(/coalesce\(c\.deceased, false\) = false/i)
  })

  it('proposes one row per pair, best-connected as winner', () => {
    expect(migration).toMatch(/\(winner\.relationship_type = 'self'\) > \(loser\.relationship_type = 'self'\)/i)
    expect(migration).toMatch(/\(winner\.matter_count, winner\.created_at, winner\.id\) > \(loser\.matter_count, loser\.created_at, loser\.id\)/i)
  })

  it('surfaces whether the names agree, which is what separates a couple from a duplicate', () => {
    expect(migration).toMatch(/as names_match/i)
  })
})

describe('the review endpoint', () => {
  const route = source(ROUTE)

  it('is admin-gated on both verbs', () => {
    expect(route.match(/requireAdmin/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('merges one reviewed pair per call, never in bulk', () => {
    expect(route).toMatch(/rpc\('merge_contacts'/)
    expect(route).not.toMatch(/for \(const .* of candidates\)/)
  })

  it('records who approved it', () => {
    expect(route).toMatch(/p_actor_id: userId/)
  })

  it('reports the function’s own validation as a conflict, not a server error', () => {
    expect(route).toMatch(/error\.code === '22023' \? 409 : 500/)
  })

  it('rejects a self-merge before reaching the database', () => {
    expect(route).toMatch(/winnerId === loserId/)
  })
})
