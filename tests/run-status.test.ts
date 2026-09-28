import { describe, expect, it } from 'vitest'
import { WORKFLOW_RUN_COLUMNS, WORKFLOW_FINDING_COLUMNS } from '@/lib/review/persist'
import { statusFromSteps, type RunStep } from '@/lib/runs/steps'
import fs from 'node:fs'
import path from 'node:path'

const MIGRATION = fs.readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20261027000000_workflow_runs_and_findings.sql'),
  'utf8',
)

/**
 * `workflow_runs` is altered again in 20261028000000_prompt_objects.sql:
 * `playbook_slug`/`playbook_version` are dropped and `prompt_version_id`/
 * `kind` are added. `columnsOf` below applies those alterations rather than
 * reading only the original `create table`, so this test still describes the
 * table as it now stands instead of the table as it stood before that
 * migration ran.
 */
const PROMPT_OBJECTS_MIGRATION = fs.readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20261028000000_prompt_objects.sql'),
  'utf8',
)

/**
 * And again in 20261227090000_review_uploads.sql, which adds
 * `review_upload_id` so a review can be of an unfiled upload.
 */
const REVIEW_UPLOADS_MIGRATION = fs.readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20261227090000_review_uploads.sql'),
  'utf8',
)

const step = (unitId: string, status: RunStep['status']): RunStep => ({
  unitId,
  status,
  attempts: 1,
  sequence: Number(unitId),
})

/**
 * The status is the one field a reader skims, so it may not overstate what the
 * run covered. A run that lost a rule to a failed model call is `partial`, and
 * calling it `completed` would say every rule was applied when one never was.
 *
 * `runStatusFor` used to compute this from finding/failure counts, and it
 * disagreed with `runStatusForAudit` in `lib/fieldAudit/persist.ts` on a run
 * with zero findings and zero failures — this one called that `failed`, the
 * other `completed`. Both are gone. `statusFromSteps` in `lib/runs/steps.ts`
 * is the one function either kind of run reads its status from now, computed
 * from the steps themselves rather than from counts kept in step with them by
 * hand in two separate files.
 */
describe("a review's run status, from its steps", () => {
  it('is completed when every rule ran', () => {
    expect(statusFromSteps([step('1', 'succeeded'), step('2', 'succeeded'), step('3', 'succeeded')])).toBe(
      'completed',
    )
  })

  it('is partial when a rule was lost', () => {
    expect(statusFromSteps([step('1', 'succeeded'), step('2', 'succeeded'), step('3', 'failed')])).toBe('partial')
  })

  it('is failed when no rule survived', () => {
    // Nothing was learned about the document, and the record should not imply
    // it was reviewed.
    expect(statusFromSteps([step('1', 'failed'), step('2', 'failed'), step('3', 'failed')])).toBe('failed')
  })

  /**
   * This is the exact case the two old functions disagreed on. Neither was
   * reachable — a run always has at least one step once it opens — which is
   * exactly why the disagreement went unnoticed.
   */
  it('is failed rather than completed for a run with no steps at all', () => {
    expect(statusFromSteps([])).toBe('failed')
  })
})

/**
 * The tables are created by the migration in this change, so the app declares
 * their columns locally until the generated types catch up. Compared against
 * the SQL so the two cannot drift while they are apart.
 */
describe('the run tables and the shapes the app declares', () => {
  const columnsOf = (table: string) => {
    const start = MIGRATION.indexOf(`create table if not exists public.${table} (`)
    const block = MIGRATION.slice(start, MIGRATION.indexOf('create index', start))
    const base = [...block.matchAll(/^\s{2}([a-z_]+) (?:uuid|text|integer|jsonb|timestamptz)/gm)].map((m) => m[1])
    if (table !== 'workflow_runs') return base

    const added = [PROMPT_OBJECTS_MIGRATION, REVIEW_UPLOADS_MIGRATION].flatMap((sql) =>
      [...sql.matchAll(/alter table public\.workflow_runs\s+add column if not exists ([a-z_]+)/g)].map((m) => m[1]),
    )
    const dropped = new Set(
      [
        ...PROMPT_OBJECTS_MIGRATION.matchAll(
          /alter table public\.workflow_runs\s+drop column if exists ([a-z_]+)/g,
        ),
      ].map((m) => m[1]),
    )
    return [...base.filter((column) => !dropped.has(column)), ...added]
  }

  it('declares exactly the workflow_runs columns', () => {
    expect([...WORKFLOW_RUN_COLUMNS].sort()).toEqual(columnsOf('workflow_runs').sort())
  })

  it('declares exactly the workflow_findings columns', () => {
    expect([...WORKFLOW_FINDING_COLUMNS].sort()).toEqual(columnsOf('workflow_findings').sort())
  })

  /**
   * A run may only be recorded against something with a durable identity: a
   * saved run about a bare upload would carry citations anchored to nothing,
   * which is the bug the citation model exists to avoid. The run tables began
   * by requiring a filed document version and its matter. An unfiled upload
   * now gets its own identity (`review_uploads`), and a review must anchor to
   * exactly one of the two — never neither — with the text layer its
   * citations index. A matter is still required for everything but an upload.
   */
  it('requires a review to anchor to exactly one durable source', () => {
    expect(MIGRATION).toMatch(/matter_id uuid not null/)
    expect(MIGRATION).toMatch(/document_version_id uuid not null/)
    expect(REVIEW_UPLOADS_MIGRATION).toMatch(
      /kind <> 'review'\s+or \(text_layer_id is not null and num_nonnulls\(document_version_id, review_upload_id\) = 1\)/,
    )
    expect(REVIEW_UPLOADS_MIGRATION).toMatch(/check \(matter_id is not null or review_upload_id is not null\)/)
    for (const table of ['document_text_layers', 'workflow_citations']) {
      expect(REVIEW_UPLOADS_MIGRATION).toMatch(
        new RegExp(`${table}_one_source\\s+check \\(num_nonnulls\\(document_version_id, review_upload_id\\) = 1\\)`),
      )
    }
  })

  it('ties a citation to the finding it supports', () => {
    expect(MIGRATION).toMatch(/alter table public\.workflow_citations[\s\S]*?finding_id uuid/)
    expect(MIGRATION).toMatch(/references public\.workflow_findings\(id\) on delete cascade/)
  })

  it('refuses a decision with no time on it', () => {
    expect(MIGRATION).toMatch(/disposition = 'open' or disposition_at is not null/)
  })

  it('refuses an attempted quote with no refusal beside it', () => {
    expect(MIGRATION).toMatch(/citation_refusal is not null or attempted_quote is null/)
  })

  it('makes cost per run answerable', () => {
    expect(MIGRATION).toMatch(/alter table public\.ai_usage[\s\S]*?workflow_run_id uuid/)
  })
})
