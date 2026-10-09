import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mergeTargetHref } from '@/lib/matters/mergeTargets'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

const MIGRATION = 'supabase/migrations/20270131090100_merge_matters.sql'
const ROUTE = 'app/api/admin/matters/[id]/merge/route.ts'

describe('merging one lead or matter into another', () => {
  const migration = source(MIGRATION)

  it('archives the merged-away record rather than deleting it', () => {
    // Every list already hides archived matters, and nothing is destroyed.
    expect(migration).toMatch(/add column if not exists merged_into_id uuid references public\.matters\(id\)/i)
    expect(migration).toMatch(/set merged_into_id = p_winner_id,\s*merged_at = now\(\),\s*status = 'archived'/i)
    expect(migration).not.toMatch(/delete from public\.matters/i)
  })

  it('refuses the merges that would corrupt the graph', () => {
    expect(migration).toMatch(/Cannot merge a matter into itself/)
    expect(migration).toMatch(/has already been merged/)
    expect(migration).toMatch(/has itself been merged away/)
    expect(migration).toMatch(/raise exception 'Service role required'/i)
  })

  it('locks both rows in a fixed order', () => {
    expect(migration).toMatch(/where id in \(p_winner_id, p_loser_id\) order by id for update/i)
  })

  it('discovers matter and intake references from the catalog', () => {
    expect(migration).toMatch(/c\.confrelid = 'public\.matters'::regclass/)
    expect(migration).toMatch(/c\.confrelid = 'public\.client_intake'::regclass/)
  })

  it('also moves the older text-keyed matter references, which have no foreign key', () => {
    for (const table of ['matter_documents', 'matter_activity', 'messages', 'sms_messages', 'email_log']) {
      expect(migration).toContain(`'${table}'`)
    }
  })

  it('moves the drafting record only when the kept matter has none', () => {
    // Two plans for the same people cannot be combined row by row.
    expect(migration).toMatch(/v_drafting := not exists \(select 1 from public\.design_sheets where matter_id = p_winner_id\)/)
    expect(migration).toMatch(/if v_ref\.tbl = any \(v_drafting_tables\) and not v_drafting then\s*continue;/)
    for (const table of ['design_sheets', 'contact_roles', 'matter_estate_clause_overrides']) {
      expect(migration).toContain(`'public.${table}'`)
    }
  })

  it('leaves the other record’s stage history alone', () => {
    expect(migration).toMatch(/v_matter_skip regclass\[\] := array\[[\s\S]*'public\.matter_stage_history'[\s\S]*'public\.matter_relationship_status_history'|v_matter_skip regclass\[\] := array\[[\s\S]*'public\.matter_relationship_status_history'[\s\S]*'public\.matter_stage_history'/)
  })

  it('keeps rows that collide with a unique key on the archived record, and reports them', () => {
    expect(migration).toMatch(/exception when others then\s*left_behind := left_behind \+ 1;/)
    expect(migration).toMatch(/rows_left jsonb not null/)
  })

  it('files documents into the kept matter’s same-named folder', () => {
    expect(migration).toMatch(/lower\(btrim\(wf\.name\)\) = lower\(btrim\(lf\.name\)\)/)
  })

  it('logs the merge and records it on the kept matter’s activity', () => {
    expect(migration).toMatch(/insert into public\.matter_merges/i)
    expect(migration).toMatch(/'matter_merged'/)
    // The activity check constraint must list the new type, or the insert
    // rolls the whole merge back — the matter_corrected lesson.
    expect(migration).toMatch(/add constraint matter_activity_event_type_check[\s\S]*'matter_corrected',\s*'matter_merged'/)
  })

  it('is callable only by the service role', () => {
    expect(migration).toMatch(/revoke all on function public\.merge_matters\(uuid, uuid, text, uuid\) from public, anon, authenticated/i)
    expect(migration).toMatch(/revoke all on function public\.merge_move_column\(regclass, text, text, text\) from public, anon, authenticated/i)
  })
})

describe('the merge endpoint', () => {
  const route = source(ROUTE)

  it('is admin-gated on both verbs', () => {
    expect(route.match(/requireAdmin/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('merges the record in the URL into the one named in the body', () => {
    expect(route).toMatch(/p_winner_id: winnerId,\s*p_loser_id: loserId/)
    expect(route).toMatch(/p_actor_id: userId/)
  })

  it('rejects a self-merge before reaching the database', () => {
    expect(route).toMatch(/winnerId === loserId/)
  })

  it('reports the function’s own validation as a conflict', () => {
    expect(route).toMatch(/error\.code === '22023' \? 409 : 500/)
  })
})

describe('where a merge target lives', () => {
  it('sends hired work to the matter page', () => {
    expect(mergeTargetHref({ id: 'm1', intakeId: 'i1', relationshipStatus: 'hired' })).toBe('/admin/matters/m1')
  })

  it('sends a lead, including a lost or declined one, to the lead page by intake id', () => {
    expect(mergeTargetHref({ id: 'm1', intakeId: 'i1', relationshipStatus: 'lead' })).toBe('/admin/leads/i1')
    expect(mergeTargetHref({ id: 'm1', intakeId: 'i1', relationshipStatus: 'lost' })).toBe('/admin/leads/i1')
  })

  it('falls back to the matter page for a lead with no intake', () => {
    expect(mergeTargetHref({ id: 'm1', intakeId: null, relationshipStatus: 'lead' })).toBe('/admin/matters/m1')
  })
})

describe('the merge action', () => {
  it('is offered on both the matter and the lead page', () => {
    expect(source('components/matter/MatterWorkspaceHeader.tsx')).toContain('Merge into another lead or matter…')
    expect(source('components/leads/LeadTopActions.tsx')).toContain('Merge into another lead or matter…')
    expect(source('app/admin/matters/[id]/MatterDialogs.tsx')).toMatch(/<MergeRecordDialog/)
    expect(source('app/admin/leads/[id]/LeadDetailClient.tsx')).toMatch(/<MergeRecordDialog/)
  })

  it('follows a merged-away record to the one it became', () => {
    expect(source('app/admin/matters/[id]/page.tsx')).toMatch(/if \(mergedHref\) redirect\(mergedHref\)/)
    expect(source('app/admin/leads/[id]/page.tsx')).toMatch(/if \(mergedHref\) redirect\(mergedHref\)/)
  })
})
