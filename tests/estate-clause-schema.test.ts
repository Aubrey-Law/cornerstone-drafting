import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260715210000_estate_clause_library.sql'), 'utf8')

describe('estate clause schema', () => {
  it('creates immutable revisions, two-person publication, overrides, and normalized provenance', () => {
    for (const table of ['estate_clauses', 'estate_clause_working_drafts', 'estate_clause_revisions', 'estate_clause_review_events', 'estate_clause_publications', 'matter_estate_clause_overrides', 'generated_document_clause_revisions']) {
      expect(sql).toContain(`public.${table}`)
    }
    expect(sql).toContain("jurisdiction text NOT NULL DEFAULT 'MA' CHECK (jurisdiction = 'MA')")
    expect(sql).toContain('v_author_id = p_actor_id')
    expect(sql).toContain('v_current_revision_id IS DISTINCT FROM p_expected_current_revision_id')
    expect(sql).toContain('prevent_estate_clause_revision_mutation')
    expect(sql).toContain('UNIQUE (document_version_id, inclusion_position)')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('TO service_role')
  })
})
