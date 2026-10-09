import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

const MIGRATION = 'supabase/migrations/20260929000000_merge_contacts.sql'
const REPAIR = 'supabase/migrations/20270131090000_merge_contacts_repair.sql'
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

})

describe('the repaired merge (20270131090000)', () => {
  const repair = source(REPAIR)

  it('no longer names calls.contact_id, which production never had', () => {
    // Every merge failed with 42703 on this one statement and rolled back.
    expect(repair).not.toMatch(/UPDATE public\.calls/i)
  })

  it('discovers every foreign key onto contacts instead of listing tables', () => {
    expect(repair).toMatch(/c\.confrelid = 'public\.contacts'::regclass/i)
    expect(repair).toMatch(/EXECUTE format\('UPDATE %s SET %I = \$1 WHERE %I = \$2'/i)
  })

  it('keeps the explicit handling for references with unique keys', () => {
    expect(repair).toMatch(/DELETE FROM public\.matter_contacts loser_link/i)
    expect(repair).toMatch(/DELETE FROM public\.contact_roles loser_role/i)
    // cornerstone_crm_people is unique on contact_id, so repointing would fail.
    expect(repair).toMatch(/DELETE FROM public\.cornerstone_crm_people WHERE contact_id = p_loser_id/i)
    expect(repair).toMatch(/NOT IN \(\s*'public\.matter_contacts'::regclass,\s*'public\.contact_roles'::regclass,\s*'public\.cornerstone_crm_people'::regclass/i)
  })

  it('still tombstones and logs rather than deleting', () => {
    expect(repair).toMatch(/SET merged_into_id = p_winner_id,\s*merged_at = now\(\)/i)
    expect(repair).toMatch(/INSERT INTO public\.contact_merges/i)
    expect(repair).not.toMatch(/DELETE FROM public\.contacts/i)
  })

  it('pairs each copy with the single kept row, not every pair in the group', () => {
    // 108 copies of one person produced 5,778 pairs before; now 107 rows.
    expect(repair).toMatch(/row_number\(\) over \(\s*partition by email_key/i)
    expect(repair).toMatch(/loser\.rank > 1/i)
    expect(repair).toMatch(/where winner\.rank = 1/i)
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

  it('keeps a self contact first, then the best-connected row', () => {
    expect(source(REPAIR)).toMatch(/order by \(relationship_type = 'self'\) desc nulls last,\s*matter_count desc, created_at desc, id desc/i)
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

  it('merges only the copies the reviewer named, one function call each', () => {
    expect(route).toMatch(/rpc\('merge_contacts'/)
    expect(route).toMatch(/for \(const loserId of \[\.\.\.new Set\(loserIds\)\]\)/)
    expect(route).not.toMatch(/for \(const .* of candidates\)/)
    expect(route).toMatch(/MAX_LOSERS_PER_CALL = 200/)
  })

  it('reports what already merged when a later copy fails', () => {
    expect(route).toMatch(/NextResponse\.json\(\{ error: error\.message, \.\.\.totals \}/)
  })

  it('records who approved it', () => {
    expect(route).toMatch(/p_actor_id: userId/)
  })

  it('reports the function’s own validation as a conflict, not a server error', () => {
    expect(route).toMatch(/error\.code === '22023' \? 409 : 500/)
  })

  it('rejects a self-merge before reaching the database', () => {
    expect(route).toMatch(/loserIds\.includes\(winnerId\)/)
  })
})

describe('the review screen', () => {
  const client = source('app/admin/contacts/merge/MergeReviewClient.tsx')

  it('shows both people side by side, not just their names', () => {
    // Nobody can judge a merge from two names and a count — the fields that
    // distinguish a couple from a duplicate are phone, DOB and the matters.
    for (const field of ['Email', 'Phone', 'Born', 'Location']) {
      expect(client).toContain(`label="${field}"`)
    }
    expect(client).toMatch(/On \$\{side\.matters\.length\} matter/)
  })

  it('labels which row survives and which goes', () => {
    expect(client).toContain('Will be removed')
    expect(client).toContain('Will be kept')
  })

  it('highlights the values that disagree between the two rows', () => {
    expect(client).toMatch(/differs=\{differs\(side\.phone, other\.phone\)\}/)
    expect(client).toMatch(/differs=\{differs\(side\.date_of_birth, other\.date_of_birth\)\}/)
  })

  it('warns loudly when the names differ', () => {
    // Same email, different names is far more often a couple sharing an inbox
    // than one person entered twice — the single most likely bad merge.
    expect(client).toMatch(/Different names on the same email/)
    expect(client).toMatch(/couple\s*\n?\s*sharing an inbox/)
  })

  it('groups copies of one person instead of listing every pair', () => {
    expect(client).toMatch(/function groupCandidates/)
    expect(client).toMatch(/Show all \$\{group\.copies\.length\} copies/)
  })

  it('offers a group merge only for copies whose names match, behind a confirmation', () => {
    expect(client).toMatch(/const sameName = group\.copies\.filter\(c => c\.namesMatch\)/)
    expect(client).toMatch(/window\.confirm\(/)
    expect(client).toMatch(/void merge\(group\.winner, sameName, group\.winner\.id\)/)
    expect(client).toMatch(/loserContactIds: copies\.map\(copy => copy\.loser\.id\)/)
  })

  it('lets a reviewer dismiss a pair without merging it', () => {
    expect(client).toContain('Not a duplicate')
  })

  it('records why the merge was approved', () => {
    expect(client).toMatch(/reason: `Reviewed duplicate — matching email/)
  })

  it('tells the reviewer what moved, and that it can be undone', () => {
    expect(client).toMatch(/matter link\(s\)/)
    expect(client).toMatch(/Reversible — the removed row is kept, not deleted/)
  })

  it('is reachable from the contacts directory', () => {
    expect(source('app/admin/contacts/ContactsClient.tsx')).toContain('/admin/contacts/merge')
  })
})

describe('the candidate payload the screen needs', () => {
  const route = source(ROUTE)

  it('returns whole people and their matters, not just the view row', () => {
    expect(route).toMatch(/from\('contacts'\)[\s\S]{0,200}\.in\('id', ids\)/)
    expect(route).toMatch(/from\('matter_contacts'\)[\s\S]{0,120}\.in\('contact_id', ids\)/)
    expect(route).toMatch(/matters: mattersByContact\.get\(id\) \?\? \[\]/)
  })

  it('skips the enrichment queries when nothing matched', () => {
    expect(route).toMatch(/if \(pairs\.length === 0\) return NextResponse\.json\(\{ candidates: \[\], likelyDuplicates: 0 \}\)/)
  })
})
