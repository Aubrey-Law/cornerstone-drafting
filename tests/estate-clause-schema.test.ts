import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260715210000_estate_clause_library.sql'), 'utf8')
const persistenceSql = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.persist_generated_estate_document'))

describe('estate clause schema', () => {
  it('creates immutable revisions, two-person publication, overrides, and normalized provenance', () => {
    for (const table of ['estate_clauses', 'estate_clause_working_drafts', 'estate_clause_revisions', 'estate_clause_review_events', 'estate_clause_publications', 'matter_estate_clause_overrides', 'generated_document_clause_revisions']) {
      expect(sql).toContain(`public.${table}`)
    }
    expect(sql).toContain("jurisdiction text NOT NULL DEFAULT 'MA' CHECK (jurisdiction = 'MA')")
    expect(sql).toContain('v_author_id = p_actor_id')
    expect(sql).toContain('v_current_revision_id IS DISTINCT FROM p_expected_current_revision_id')
    expect(sql).toContain('v_base_published_revision_id IS DISTINCT FROM p_expected_current_revision_id')
    expect(sql).toContain('v_base_published_revision_id IS DISTINCT FROM v_current_revision_id')
    expect(sql).toContain('JOIN public.estate_clause_publications p ON p.clause_id = r.clause_id')
    expect(sql).toContain('p.current_revision_id = r.id')
    expect(sql).toContain('AND c.is_active')
    expect(persistenceSql).toContain('FOR SHARE')
    expect(sql).toContain('comment IS NOT NULL')
    expect(sql).toContain('The author can continue from the reviewed proposal')
    expect(sql).toContain('ON CONFLICT (clause_id, author_id) DO NOTHING')
    expect(sql).toContain('prevent_estate_clause_revision_mutation')
    expect(sql).toContain('UNIQUE (document_version_id, inclusion_position)')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('TO service_role')
  })
})
