import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FieldReference } from '@aubrey-law/citations/fieldAudit/types'

const MIGRATION = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261028000000_prompt_objects.sql'),
  'utf8',
)

/**
 * Slices out one `create table` statement so assertions about a table's
 * columns can't accidentally match text belonging to a different table (the
 * workflow_runs alterations below, in particular, reuse words like `kind`
 * and `check` that also appear inside the new tables).
 */
const tableBlock = (table: string) => {
  const start = MIGRATION.indexOf(`create table if not exists public.${table} (`)
  if (start === -1) throw new Error(`table ${table} not found in migration`)
  const end = MIGRATION.indexOf('\n);', start)
  if (end === -1) throw new Error(`no closing ");" found for table ${table}`)
  return MIGRATION.slice(start, end)
}

const columnsOf = (table: string) =>
  [...tableBlock(table).matchAll(/^\s{2}([a-z_]+) (?:uuid|text|text\[\]|jsonb|integer|boolean|timestamptz)\b/gm)].map(
    (m) => m[1],
  )

/**
 * The mapping from FieldReference's own fields to the columns that must
 * store them. Typed with `satisfies Record<keyof FieldReference, ...>` so
 * that if FieldReference ever gains or loses a field, `tsc` (via `npm run
 * verify`) fails this file to compile rather than letting the test silently
 * stop covering the real type. A test that only checked today's five column
 * names as string literals would keep passing after that drift; this does
 * not.
 */
const FIELD_REFERENCE_COLUMNS = {
  fieldKey: 'field_key',
  claimedValue: 'claimed_value',
  actualValue: 'actual_value',
  verification: 'verification',
  matchedPath: 'matched_path',
} satisfies Record<keyof FieldReference, string>

describe('prompt objects and the run that stops assuming a document', () => {
  /**
   * A content hash that isn't a sha-256 hex digest can't be compared for
   * equality the way publishing does elsewhere (estate_clause_revisions
   * uses the identical check) -- a looser shape would let two different
   * hash schemes collide or silently coexist. Anchored to the exact column
   * declaration, not just the bare regex, so this fails if the check is
   * ever moved off the column it's meant to guard.
   */
  it('constrains prompt_versions.content_hash to a sha-256 hex digest', () => {
    const block = tableBlock('prompt_versions')
    expect(block).toMatch(/content_hash text not null check \(content_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/)
  })

  /**
   * The whole point of the composite foreign key: a prompt_versions row
   * naming a kind that its prompt doesn't have must fail to insert. That
   * only holds if prompts actually publishes (id, kind) as a target --
   * checking just the foreign-key clause would pass even if someone deleted
   * the `unique (id, kind)` it depends on, so both are asserted.
   */
  it('cannot let a version claim a kind its prompt does not have', () => {
    const prompts = tableBlock('prompts')
    const versions = tableBlock('prompt_versions')
    expect(prompts).toMatch(/unique \(id, kind\)/)
    expect(versions).toMatch(/foreign key \(prompt_id, kind\) references public\.prompts\(id, kind\)/)
  })

  /**
   * One current version per prompt is supposed to hold by the row's shape,
   * not by a rule someone has to remember to enforce. That only follows if
   * prompt_id is the primary key -- a surrogate id column alongside a merely
   * unique prompt_id would let the table be edited back into "one row per
   * prompt" being a convention instead of a guarantee, so a surrogate key is
   * ruled out as well as the primary key asserted.
   */
  it('keys prompt_publications on prompt_id so a second current version cannot exist', () => {
    const block = tableBlock('prompt_publications')
    expect(block).toMatch(/prompt_id uuid primary key references public\.prompts\(id\)/)
    expect(block).not.toMatch(/id uuid primary key default gen_random_uuid\(\)/)
  })

  /**
   * The composite foreign key from prompt_publications into prompt_versions
   * is what stops a publication from pointing at a version of the wrong
   * prompt -- the same failure mode the clause library's publications guard
   * against. Checked against the specific columns, not just that some
   * foreign key exists on the table.
   */
  it('cannot let a publication point at a version of a different prompt', () => {
    const block = tableBlock('prompt_publications')
    expect(block).toMatch(
      /foreign key \(version_id, prompt_id\)\s*\n?\s*references public\.prompt_versions\(id, prompt_id\)/,
    )
  })

  /**
   * A review run genuinely has nothing to have reviewed without a document;
   * a field audit runs against a matter's declared facts and normally has
   * none. Both halves are checked -- the constraint text itself, and that
   * the column-level NOT NULL it replaces was actually lifted, since a
   * lingering NOT NULL would make the constraint's "field audit" half dead
   * code no field-audit run could ever exercise.
   */
  it('requires a document only for a review run, and only after document_version_id could be null', () => {
    expect(MIGRATION).toMatch(/alter column document_version_id drop not null/)
    expect(MIGRATION).toMatch(
      /constraint workflow_runs_review_needs_document\s*\n?\s*check \(kind <> 'review' or \(document_version_id is not null and text_layer_id is not null\)\)/,
    )
  })

  /**
   * kind is denormalised onto workflow_runs specifically so the constraint
   * above can check it without a join. If kind had no default, every
   * existing row (all of them reviews, from before prompts existed) would
   * need a value supplied by this migration or the column add would fail --
   * the default is not cosmetic.
   */
  it('defaults workflow_runs.kind to review for the rows that predate prompts', () => {
    expect(MIGRATION).toMatch(/add column if not exists kind text not null default 'review'/)
  })

  /**
   * playbook_slug and playbook_version are superseded by prompt_version_id,
   * which points at an immutable row instead of a slug+integer pair that
   * could be edited out from under a run after the fact. Also checks
   * neither is re-added anywhere below the drop, which a careless
   * copy-paste of the old insert shape elsewhere in the file could do
   * without this failing.
   */
  it('drops both playbook columns and does not resurrect either', () => {
    expect(MIGRATION).toMatch(/drop column if exists playbook_slug/)
    expect(MIGRATION).toMatch(/drop column if exists playbook_version/)
    expect(MIGRATION).not.toMatch(/add column if not exists playbook_slug/)
    expect(MIGRATION).not.toMatch(/add column if not exists playbook_version/)
  })

  /**
   * Every new table defaults to closed until a policy opens it. Missing
   * this on any one of the four would leave that table readable only by the
   * service-role client -- invisible to the staff UI with no error, the
   * quiet failure mode RLS bugs take.
   */
  it('enables row level security on all four new tables', () => {
    for (const table of ['prompts', 'prompt_versions', 'prompt_publications', 'workflow_field_references']) {
      expect(MIGRATION).toMatch(new RegExp(`alter table public\\.${table} enable row level security`))
    }
  })

  /**
   * RLS enabled with no policy is as opaque to staff as no table at all --
   * this checks the actual read grant exists for every one of the four,
   * matching the role list every other workflow_* policy uses.
   */
  it('grants staff read access on all four new tables', () => {
    for (const table of ['prompts', 'prompt_versions', 'prompt_publications', 'workflow_field_references']) {
      const policyBlock = MIGRATION.slice(MIGRATION.indexOf(`on public.${table}\n  for select`))
      expect(policyBlock.slice(0, 300)).toMatch(/role in \('admin', 'attorney', 'va', 'staff'\)/)
    }
  })

  /**
   * A field reference the code produces but the table cannot hold is data
   * silently lost the moment it's written. Every field of FieldReference --
   * including matchedPath, the one that's easy to miss because it has no
   * counterpart on the citation side of the schema -- must have a column.
   * The mapping itself is typechecked against FieldReference (see above);
   * this asserts the migration actually declares each of its columns.
   */
  it('stores every field of FieldReference, including the easy-to-miss matchedPath', () => {
    const columns = columnsOf('workflow_field_references')
    for (const column of Object.values(FIELD_REFERENCE_COLUMNS)) {
      expect(columns).toContain(column)
    }
  })

  /**
   * verification is constrained to the three states the type declares --
   * a fourth value slipping in would be accepted by the column but
   * unrepresentable in FieldVerification, breaking round-tripping silently.
   */
  it('constrains verification to the same three states as FieldVerification', () => {
    const block = tableBlock('workflow_field_references')
    expect(block).toMatch(/verification text not null\s*\n?\s*check \(verification = any \(array\['verified', 'unverified', 'stale'\]\)\)/)
  })
})
