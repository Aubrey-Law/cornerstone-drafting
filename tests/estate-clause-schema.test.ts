import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260715210000_estate_clause_library.sql'), 'utf8')
const soloPublicationSql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260716130000_solo_attorney_estate_clause_publication.sql'),
  'utf8',
)
const persistenceSql = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.persist_generated_estate_document'))

describe('estate clause schema', () => {
  it('creates immutable revisions, two-person publication, overrides, and normalized provenance', () => {
    for (const table of ['estate_clauses', 'estate_clause_working_drafts', 'estate_clause_revisions', 'estate_clause_review_events', 'estate_clause_publications', 'estate_clause_preview_evidence', 'matter_estate_clause_overrides', 'generated_document_clause_revisions']) {
      expect(sql).toContain(`public.${table}`)
    }
    expect(sql).toContain("jurisdiction text NOT NULL DEFAULT 'MA' CHECK (jurisdiction = 'MA')")
    expect(sql).toContain('v_author_id = p_actor_id')
    expect(sql).toContain('v_current_revision_id IS DISTINCT FROM p_expected_current_revision_id')
    expect(sql).toContain('v_base_published_revision_id IS DISTINCT FROM p_expected_current_revision_id')
    expect(sql).toContain('v_base_published_revision_id IS DISTINCT FROM v_current_revision_id')
    expect(persistenceSql).toContain('FROM public.estate_clause_review_events e')
    expect(persistenceSql).toContain("e.event_type = 'published'")
    expect(persistenceSql).not.toContain('p.current_revision_id = v_revision_id')
    expect(sql).toContain('comment IS NOT NULL')
    expect(sql).toContain('The author can continue from the reviewed proposal')
    expect(sql).toContain('ON CONFLICT (clause_id, author_id) DO NOTHING')
    expect(sql).toContain('source_review_revision_id uuid')
    expect(sql).toContain('v_revision.author_id, v_revision.id')
    expect(sql).toContain('prevent_estate_clause_revision_mutation')
    expect(sql).toContain('UNIQUE (document_version_id, clause_key)')
    expect(sql).toContain('CREATE TRIGGER generated_document_clause_revisions_immutable')
    expect(sql).toContain('generated_document_clause_revisions_position_idx')
    expect(sql).toContain('(included AND inclusion_position IS NOT NULL)')
    expect(sql).toContain('(NOT included AND inclusion_position IS NULL)')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('TO service_role')
  })

  it('keeps override history immutable and snapshots publications with active events atomically', () => {
    expect(sql).toContain("event_type text NOT NULL CHECK (event_type IN ('applied', 'retired'))")
    expect(sql).toContain('publication_revision_id uuid NOT NULL')
    expect(sql).toContain('supersedes_override_id uuid')
    expect(sql).toContain('CREATE TRIGGER matter_estate_clause_overrides_immutable')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.retire_matter_estate_clause_override')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.load_estate_clause_generation_snapshot')
    expect(sql).toContain("DISTINCT ON (o.clause_id)")
    expect(sql).not.toContain('ON CONFLICT (matter_id, clause_id) DO UPDATE')
  })

  it('persists included and omitted override decisions against immutable events', () => {
    expect(sql).toContain('included boolean NOT NULL')
    expect(sql).toContain('override_action text')
    expect(sql).toContain("o.event_type = 'applied'")
    expect(sql).toContain('o.publication_revision_id = v_revision_id')
    expect(sql).toContain("o.action = v_override_action")
  })

  it('requires immutable successful preview evidence before publication', () => {
    expect(sql).toContain('CREATE TABLE public.estate_clause_preview_evidence')
    expect(sql).toContain('template_snapshot_hash text NOT NULL')
    expect(sql).toContain('dependency_revision_ids jsonb NOT NULL')
    expect(sql).toContain('template_publication_revision_ids jsonb NOT NULL')
    expect(sql).toContain('CREATE TRIGGER estate_clause_preview_evidence_immutable')
    expect(sql).toContain('cardinality(v_preview_document_types)')
    expect(sql).toContain('v_preview_document_types @> v_document_types')
    expect(sql).toContain('pe.template_snapshot_hash = p_current_template_snapshot_hash')
    expect(sql).toContain('pe.dependency_revision_ids = v_dependency_revision_ids')
    expect(sql).toContain('pe.template_publication_revision_ids = v_template_publication_revision_ids')
    expect(sql).toContain('FOR SHARE OF p')
    expect(sql).toContain('CREATE TRIGGER estate_clause_publications_serialized')
    expect(sql).toContain("hashtextextended('estate-clause-publications', 0)")
    expect(sql).toContain('CREATE TRIGGER estate_template_publications_serialized')
    expect(sql).toContain('WITH RECURSIVE dependency_graph')
    expect(sql).toContain('Estate clause dependency has no current publication')
    expect(sql).toContain('Estate clause dependency graph contains a cycle')
  })

  it('supports transactional audited retirement and reversion without erasing history', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.retire_estate_clause_publication')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.revert_estate_clause_publication')
    expect(sql).toContain("'retired'")
    expect(sql).toContain("'publication_reverted'")
    expect(sql).toContain('p_expected_current_revision_id')
  })

  it('allows an authorized solo attorney while preserving every non-personnel publication gate', () => {
    for (const functionName of [
      'request_estate_clause_changes',
      'publish_estate_clause_revision',
      'revert_estate_clause_publication',
    ]) {
      expect(soloPublicationSql).toContain(`CREATE OR REPLACE FUNCTION public.${functionName}`)
      expect(soloPublicationSql).toContain(`REVOKE ALL ON FUNCTION public.${functionName}`)
      expect(soloPublicationSql).toContain(`GRANT EXECUTE ON FUNCTION public.${functionName}`)
    }

    expect(soloPublicationSql).not.toMatch(/different attorney|different administrator/i)
    expect(soloPublicationSql).not.toContain('v_revision.author_id = p_actor_id')
    expect(soloPublicationSql).not.toContain('v_author_id = p_actor_id')
    expect(soloPublicationSql).not.toContain('v_target_author_id = p_actor_id')

    expect(soloPublicationSql).toContain("u.role IN ('attorney', 'admin')")
    expect(soloPublicationSql).toContain("v_latest_event IS DISTINCT FROM 'submitted'")
    expect(soloPublicationSql).toContain("v_validation_status <> 'valid'")
    expect(soloPublicationSql).toContain('pe.template_snapshot_hash = p_current_template_snapshot_hash')
    expect(soloPublicationSql).toContain('pe.dependency_revision_ids = v_dependency_revision_ids')
    expect(soloPublicationSql).toContain('v_current_revision_id IS DISTINCT FROM p_expected_current_revision_id')
    expect(soloPublicationSql).toContain("hashtextextended('estate-clause-publications', 0)")
    expect(soloPublicationSql).toContain("'changes_requested'")
    expect(soloPublicationSql).toContain("'published'")
    expect(soloPublicationSql).toContain("'publication_reverted'")
  })
})
