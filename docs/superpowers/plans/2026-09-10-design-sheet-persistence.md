# Design-Sheet Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the design sheet one home and one safe write path, and make the audit read where the data actually is.

**Architecture:** Fold `matters.li_design_sheet_data` into `design_sheets.decisions`; add a `lock_version` column and a compare-and-swap write; teach the prompt input allow-list to resolve a key inside `decisions`; port the persistence helpers and the intake bridge into `apps/workbench`.

**Tech Stack:** TypeScript, Supabase JS, plpgsql, vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-design-sheet-persistence-design.md`

---

## Facts you need before starting

Verified against the repository and the live database on 2026-09-10. Do not re-derive; do not assume anything not listed.

**The three homes and their sizes:**

| home | population |
| --- | --- |
| `design_sheets` columns | 45 rows over 45 matters, one `version` each (all 1) |
| `design_sheets.decisions` jsonb | 41 of 45 non-empty |
| `matters.li_design_sheet_data` jsonb | 10 matters, keys `residuary_spouse_survives` and `residuary_no_spouse`, both `string`, **zero** collisions with existing `decisions` keys, and all 10 already have a `design_sheets` row |

**Why this matters:** the `ma-design-sheet-audit` prompt resolves
`design_sheet.residuary_beneficiary` — a **column**, empty on all 44 latest
sheets and never written. Seven of the nine blocker findings raised on
2026-09-08/09 were against matters that *do* have a residuary, in the blob:
`0528d2db`, `10904a59`, `48aac2c1`, `590a0498`, `d11717cd`, `e10908ee`,
`fadd6263`.

**Constraints already on `design_sheets`:** `design_sheets_pkey` on `id`, and
`design_sheets_matter_id_version_key` unique on `(matter_id, version)`.

**Do not repurpose `version` as the concurrency token.**
`20260813000001_design_sheet_unique_version.sql` states the invariant: "One
design sheet per (matter_id, version)". And do not switch to a row-per-save
model: **26 files touch `design_sheets` and only 10 order by version**;
`app/api/admin/matters/[id]/design-sheet/route.ts:73` calls `.maybeSingle()`,
which throws once a second version exists.

**Two coupled files you must keep in step**, or reads silently return `null`:
- `packages/citations/src/prompt/inputs.ts` — `SOURCE_ALLOW_LIST`, 35 entries of `{ table, column }`, plus `resolveInputs` and `unknownSources`.
- `apps/workbench/lib/prompts/designSheet.ts` — derives `DESIGN_SHEET_COLUMNS` / `MATTER_COLUMNS` from that list and asserts its **literal** select strings still match. The literals are deliberate: `tests/query-columns.test.ts` and `scripts/checkDbColumns.mjs` can only see column names written as string literals.

**Migration naming:** `supabase/migrations/YYYYMMDDHHMMSS_name.sql`; latest is `20261119000000_matter_corrected_activity_type.sql`.

**Never** verify an applied migration from `supabase_migrations.schema_migrations` — this project has had a migration recorded as applied whose body never ran. Read `information_schema` / `pg_proc` instead.

**CI's test job has no Supabase environment** (`.github/workflows/app-ci.yml`), so migrations are asserted against their SQL text — the idiom `tests/engagement-repository.test.ts` uses — and behaviour is proven by hand in a rolled-back transaction.

**Root vitest collects `tests/**` only.** Workbench tests live in `apps/workbench/tests/**` and run under `npm run -w apps/workbench verify`, which CI runs separately.

---

## File Structure

| file | responsibility |
| --- | --- |
| `supabase/migrations/20261120000000_design_sheet_lock_version.sql` | add the CAS column |
| `supabase/migrations/20261121000000_fold_li_design_sheet_data.sql` | move 10 blobs into `decisions`, refusing on collision |
| `packages/citations/src/prompt/inputs.ts` | `jsonKey` on an allow-list entry; `resolveInputs` reads through it |
| `apps/workbench/lib/prompts/designSheet.ts` | include `decisions` in the literal select |
| `apps/workbench/lib/designSheet/persistence.ts` | the ported writer, with CAS |
| `apps/workbench/lib/designSheet/seedFromIntake.ts` | ported verbatim |
| `apps/workbench/lib/contacts/intakeFiduciarySnapshot.ts` | ported verbatim |
| `tests/design-sheet-persistence.test.ts` | the two migrations' SQL text (root suite) |
| `apps/workbench/tests/design-sheet-persistence.test.ts` | CAS and resolution (workbench suite) |

---

### Task 1: The `lock_version` column

**Files:**
- Create: `supabase/migrations/20261120000000_design_sheet_lock_version.sql`
- Test: `tests/design-sheet-persistence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/design-sheet-persistence.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const sqlOf = (name: string) => readFileSync(join(root, 'supabase/migrations', name), 'utf8')

/**
 * The concurrency token for design-sheet saves.
 *
 * Deliberately NOT `version`: `20260813000001_design_sheet_unique_version.sql`
 * states the invariant "one design sheet per (matter_id, version)", so
 * incrementing it per save would redefine a documented column. And
 * deliberately not a row-per-save model — 26 files touch `design_sheets` and
 * only 10 order by version; `design-sheet/route.ts:73` calls `.maybeSingle()`,
 * which throws once a second version exists.
 */
describe('the lock_version migration', () => {
  const sql = sqlOf('20261120000000_design_sheet_lock_version.sql')

  it('adds the column with a default, so no row needs backfilling', () => {
    expect(sql).toMatch(/add column if not exists lock_version integer not null default 0/i)
  })

  it('leaves version alone', () => {
    // The whole point of a separate column.
    expect(sql).not.toMatch(/drop column .*\bversion\b|alter column version/i)
  })

  it('reloads PostgREST, which serves a cached schema', () => {
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/design-sheet-persistence.test.ts`
Expected: FAIL — `ENOENT` on the migration file.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261120000000_design_sheet_lock_version.sql`:

```sql
-- A concurrency token for design-sheet saves.
--
-- `saveLiDesignSheet` in the root app writes with no version check at all, so
-- two tabs open on one matter means the second save silently discards the
-- first — on a legal design sheet.
--
-- NOT `version`, which already exists. 20260813000001 states the invariant it
-- carries: "one design sheet per (matter_id, version)". Incrementing it per
-- save would redefine a documented column.
--
-- NOT a row per save either, elegant as that would be — the unique constraint
-- would give compare-and-swap for free and real revision history with it. But
-- 26 files touch design_sheets and only 10 order by version, and several call
-- `.maybeSingle()`, which throws rather than reading stale once a second
-- version exists. That is a 16-file audit, not a persistence change.
--
-- Defaulted, so every existing row is valid immediately and no backfill runs.
alter table public.design_sheets
  add column if not exists lock_version integer not null default 0;

comment on column public.design_sheets.lock_version is
  'Optimistic-concurrency token. Callers pass the value they read; the update increments it and matches on it, so a save against a stale read affects no rows. Distinct from `version`, which identifies the sheet revision.';

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/design-sheet-persistence.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Prove the second test is load-bearing**

Temporarily add `alter table public.design_sheets alter column version set default 1;` to the migration, re-run, and confirm `leaves version alone` goes RED. Remove the line and re-run to confirm 3 pass. A guard whose test passes either way guards nothing.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261120000000_design_sheet_lock_version.sql tests/design-sheet-persistence.test.ts
git commit -m "A concurrency token for design-sheet saves

saveLiDesignSheet writes with no version check, so two tabs on one matter
means the second save silently discards the first.

A separate column rather than reusing version, whose meaning the schema
states, and rather than a row per save, which 16 non-version-ordering
readers would not survive.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Fold the ten blobs into `decisions`

**Files:**
- Create: `supabase/migrations/20261121000000_fold_li_design_sheet_data.sql`
- Test: `tests/design-sheet-persistence.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/design-sheet-persistence.test.ts` (`sqlOf` and the imports already exist — reuse them):

```ts
/**
 * Moving the residuary to where the audit can see it.
 *
 * `ResiduarySection.tsx` writes `residuary_spouse_survives` and
 * `residuary_no_spouse` into `matters.li_design_sheet_data`. The audit reads
 * `design_sheet.residuary_beneficiary`, a column nothing writes. Seven of the
 * nine blocker findings raised on 2026-09-08/09 were against matters that DO
 * have a residuary recorded.
 */
describe('the li_design_sheet_data fold', () => {
  const sql = sqlOf('20261121000000_fold_li_design_sheet_data.sql')

  it('merges the blob into the latest sheet’s decisions', () => {
    expect(sql).toMatch(/decisions\s*=\s*coalesce\(d\.decisions, '\{\}'::jsonb\)\s*\|\|/i)
  })

  /**
   * Scoped on the UPDATE statement, not merely somewhere in the file.
   *
   * An earlier version of this test asserted `/max\(version\)/` against the
   * whole migration, and passed even with the scoping deleted from the update
   * — because the collision-check block legitimately contains the same
   * clause. A test that cannot fail for the reason it names is worse than
   * none: it reports the guard as covered.
   */
  it('scopes the update itself to the latest version, since readers take max(version)', () => {
    const start = sql.indexOf('update public.design_sheets')
    expect(start).toBeGreaterThan(-1)
    const statement = sql.slice(start, sql.indexOf(';', start))
    expect(statement).toMatch(/d\.version\s*=\s*\(select max\(version\)/i)
  })

  it('refuses rather than merging when a key already exists', () => {
    // Measured at zero collisions on 2026-09-10 — asserted here rather than
    // trusted, because a merge that silently overwrote a decision would be
    // undetectable afterwards.
    expect(sql).toMatch(/raise exception/i)
    expect(sql).toMatch(/\?\|/)
  })

  it('does not drop the column it reads from', () => {
    // 17 code sites still read it. The repo's rule, from
    // 20261013000000_drop_twenty_sync_columns.sql: a column is never dropped
    // in the same PR as its last code reference, because migrations and code
    // deploy in no guaranteed order.
    expect(sql).not.toMatch(/drop column .*li_design_sheet_data/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/design-sheet-persistence.test.ts`
Expected: FAIL — `ENOENT` on the new migration.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20261121000000_fold_li_design_sheet_data.sql`:

```sql
-- Fold matters.li_design_sheet_data into the design sheet's decisions.
--
-- The design sheet has had three homes: columns on `design_sheets`, the
-- `decisions` jsonb beside them, and this blob on `matters`. The third is
-- where `ResiduarySection.tsx` writes, and the audit does not read it — so a
-- check asking "is a residuary recorded?" looked at an always-empty column and
-- raised blocker findings against seven matters that had one.
--
-- Measured 2026-09-10: 10 matters, two keys each
-- (`residuary_spouse_survives`, `residuary_no_spouse`), zero collisions with
-- keys already in `decisions`, and all 10 already have a `design_sheets` row.
-- The collision check below asserts that rather than trusting it: a merge that
-- silently overwrote a recorded decision would be undetectable afterwards.
--
-- The column is NOT dropped. 17 code sites still read it, and the repo's rule
-- (20261013000000_drop_twenty_sync_columns.sql) is that a column is never
-- dropped in the same PR as its last code reference.

do $$
declare
  v_collisions int;
begin
  select count(*) into v_collisions
    from public.matters m
    join public.design_sheets d on d.matter_id = m.id
     and d.version = (select max(version) from public.design_sheets x where x.matter_id = m.id)
   where m.li_design_sheet_data is not null
     and m.li_design_sheet_data <> '{}'::jsonb
     and coalesce(d.decisions, '{}'::jsonb) ?| array(select jsonb_object_keys(m.li_design_sheet_data));

  if v_collisions > 0 then
    raise exception 'Refusing to fold: % sheet(s) already carry a key from li_design_sheet_data', v_collisions;
  end if;
end $$;

update public.design_sheets d
   set decisions = coalesce(d.decisions, '{}'::jsonb) || m.li_design_sheet_data
  from public.matters m
 where m.id = d.matter_id
   and m.li_design_sheet_data is not null
   and m.li_design_sheet_data <> '{}'::jsonb
   and d.version = (select max(version) from public.design_sheets x where x.matter_id = m.id);

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/design-sheet-persistence.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Falsify two of the guards**

A guard whose test passes either way guards nothing. For each mutation below:
apply it, re-run the test file, note which test goes red, then restore the file
exactly and re-run to confirm 7 pass.

1. Replace the `?|` collision condition with `and false` — `refuses rather
   than merging` must go red.
2. Delete the `and d.version = (select max(version) …)` line from **the
   `update` statement only**, leaving the collision block's copy in place —
   `scopes the update itself` must go red.

Mutation 2 is why that test slices the update statement out before asserting.
The first version of it matched the clause anywhere in the file and passed with
the update unscoped; the mutation is what exposed that, and it is why the
mutation is specified this precisely.

If a mutation is NOT caught, say so plainly rather than adjusting the test to
make it look caught.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261121000000_fold_li_design_sheet_data.sql tests/design-sheet-persistence.test.ts
git commit -m "Fold li_design_sheet_data into the sheet's decisions

The residuary lives in a blob on matters; the audit reads a column on
design_sheets that nothing writes. Seven of nine blocker findings were
raised against matters that had a residuary recorded.

Refuses on collision rather than merging — measured at zero today, but a
silent overwrite of a recorded decision would be undetectable. The column
is not dropped: 17 readers remain.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Let the allow-list reach inside `decisions`

**Files:**
- Modify: `packages/citations/src/prompt/inputs.ts`
- Modify: `apps/workbench/lib/prompts/designSheet.ts`
- Test: `apps/workbench/tests/prompt-inputs.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/workbench/tests/prompt-inputs.test.ts`:

```ts
/**
 * An input that lives inside the `decisions` blob rather than in a column.
 *
 * The residuary is written there by `ResiduarySection.tsx`. Before this, the
 * allow-list could only name a column, so the audit resolved
 * `design_sheet.residuary_beneficiary` — always empty — and reported no
 * residuary on matters that had one.
 */
describe('inputs that resolve through decisions', () => {
  it('reads the named key out of the decisions blob', () => {
    const resolved = resolveInputs(
      [{ key: 'residuary_spouse_survives', source: 'design_sheet.residuary_spouse_survives', required: false }],
      { design_sheet: { decisions: { residuary_spouse_survives: 'to my spouse outright' } }, matter: {} },
    )
    expect(resolved).toEqual({ ok: true, values: { residuary_spouse_survives: 'to my spouse outright' } })
  })

  it('treats a missing key as absent, not as a broken prompt', () => {
    // Absent is an answer — the attorney has not recorded it yet. Unresolvable
    // means the prompt names something the allow-list does not have, which is
    // a different and louder failure.
    const resolved = resolveInputs(
      [{ key: 'residuary_no_spouse', source: 'design_sheet.residuary_no_spouse', required: false }],
      { design_sheet: { decisions: {} }, matter: {} },
    )
    expect(resolved).toEqual({ ok: true, values: { residuary_no_spouse: null } })
  })

  it('reports a required decisions key that is missing', () => {
    const resolved = resolveInputs(
      [{ key: 'residuary_no_spouse', source: 'design_sheet.residuary_no_spouse', required: true }],
      { design_sheet: { decisions: {} }, matter: {} },
    )
    expect(resolved).toEqual({ ok: false, missing: ['design_sheet.residuary_no_spouse'], unresolvable: [] })
  })

  it('still selects the decisions column, or every such read returns null', () => {
    // designSheet.ts's literal select must carry `decisions`, otherwise the
    // row handed to resolveInputs has no such property and every jsonKey
    // input resolves to null — indistinguishable from an empty field.
    expect(DESIGN_SHEET_SELECT).toContain('decisions')
  })
})
```

Add `DESIGN_SHEET_SELECT` to the imports at the top of that file:

```ts
import { DESIGN_SHEET_SELECT } from '@/lib/prompts/designSheet'
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test --workspace apps/workbench -- tests/prompt-inputs.test.ts`
Expected: FAIL — the resolver returns `null` for the decisions reads, and `DESIGN_SHEET_SELECT` may not be exported.

If `DESIGN_SHEET_SELECT` is not currently exported from `apps/workbench/lib/prompts/designSheet.ts`, export it (add `export` to the existing `const`) — do not rename or rebuild it, and keep it one unbroken string literal.

- [ ] **Step 3: Extend the allow-list entry type**

In `packages/citations/src/prompt/inputs.ts`, change the exported type and add the four residuary entries:

```ts
export const SOURCE_ALLOW_LIST: Record<
  string,
  { table: 'design_sheet' | 'matter'; column: string; jsonKey?: string }
> = {
```

Then add these entries beside the existing `design_sheet.*` ones:

```ts
  // Written by ResiduarySection.tsx into the decisions blob, not into a
  // column. The four columns named `residuary_*` are never written by
  // anything; reading them is what made the audit report no residuary on
  // matters that had one.
  'design_sheet.residuary_spouse_survives': { table: 'design_sheet', column: 'decisions', jsonKey: 'residuary_spouse_survives' },
  'design_sheet.residuary_no_spouse': { table: 'design_sheet', column: 'decisions', jsonKey: 'residuary_no_spouse' },
  'design_sheet.residuary_other_instructions': { table: 'design_sheet', column: 'decisions', jsonKey: 'residuary_other_instructions' },
  'design_sheet.residuary_specific_gifts': { table: 'design_sheet', column: 'decisions', jsonKey: 'residuary_specific_gifts' },
```

- [ ] **Step 4: Resolve through the key**

In the same file, inside `resolveInputs`, replace the single value lookup:

```ts
    const value = rows[entry.table]?.[entry.column] ?? null
```

with:

```ts
    // A `jsonKey` entry names a key inside a jsonb column rather than the
    // column itself. `?? null` on the outer read keeps a missing column and a
    // missing key indistinguishable to `isEmpty`, which is correct: both mean
    // the attorney has not recorded it.
    const raw = rows[entry.table]?.[entry.column] ?? null
    const value = entry.jsonKey
      ? ((raw as Record<string, unknown> | null)?.[entry.jsonKey] ?? null)
      : raw
```

- [ ] **Step 5: Make sure the select carries `decisions`**

In `apps/workbench/lib/prompts/designSheet.ts`, add `decisions` to the design-sheet select literal, keeping it **one unbroken string** (`stringConstants` in `scripts/lib/queryReferences.mjs` only recognises a `const` whose initializer is a single literal). `assertSelectMatches` derives its expectation from `SOURCE_ALLOW_LIST`, and `decisions` is now among the columns that list names, so the assertion continues to hold without being weakened.

- [ ] **Step 6: Run the tests**

```bash
npm run test --workspace apps/workbench -- tests/prompt-inputs.test.ts
npm run typecheck
npm run typecheck --workspace apps/workbench
```

Expected: all pass; both typechecks clean.

- [ ] **Step 7: Prove the select guard is load-bearing**

Remove `decisions` from the select literal and re-run the test file. Expected: the `still selects the decisions column` test goes RED, and `assertSelectMatches` fails too. Restore it and re-run.

This is the failure the whole task exists to prevent: a resolvable input whose column is not selected returns `null`, and null is indistinguishable from an empty field.

- [ ] **Step 8: Commit**

```bash
git add packages/citations/src/prompt/inputs.ts apps/workbench/lib/prompts/designSheet.ts apps/workbench/tests/prompt-inputs.test.ts
git commit -m "Let a prompt input name a key inside decisions

ResiduarySection writes the residuary into the decisions blob; the
allow-list could only name a column, so the audit read an always-empty
one and reported no residuary on matters that had one.

The select literal must carry `decisions` or every such read returns
null, which is indistinguishable from an empty field — a test pins it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The workbench writer, with compare-and-swap

**Files:**
- Create: `apps/workbench/lib/designSheet/persistence.ts`
- Test: `apps/workbench/tests/design-sheet-persistence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/workbench/tests/design-sheet-persistence.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { saveDesignSheet } from '@/lib/designSheet/persistence'

/**
 * A fake that records the filters as well as the payload, because which rows
 * an update matches is the whole subject here.
 */
function fakeClient(affected: number) {
  const calls: Array<{ payload: Record<string, unknown>; filters: Array<[string, unknown]> }> = []
  return {
    calls,
    from() {
      const call = { payload: {} as Record<string, unknown>, filters: [] as Array<[string, unknown]> }
      const chain: Record<string, unknown> = {
        update: (payload: Record<string, unknown>) => {
          call.payload = payload
          calls.push(call)
          return chain
        },
        eq: (column: string, value: unknown) => {
          call.filters.push([column, value])
          return chain
        },
        select: () => Promise.resolve({ data: Array.from({ length: affected }, () => ({ id: 'x' })), error: null }),
      }
      return chain
    },
  }
}

describe('saveDesignSheet', () => {
  it('writes when the lock_version it was given still matches', async () => {
    const client = fakeClient(1)
    const result = await saveDesignSheet(client as never, {
      matterId: 'matter-1',
      expectedLockVersion: 3,
      fields: { concerns: 'updated' },
    })
    expect(result).toEqual({ ok: true })
    expect(client.calls[0].payload).toEqual({ concerns: 'updated', lock_version: 4 })
    expect(client.calls[0].filters).toEqual([
      ['matter_id', 'matter-1'],
      ['lock_version', 3],
    ])
  })

  it('reports a lost race rather than throwing or silently succeeding', async () => {
    // Zero rows matched: someone else saved between the read and this write.
    // Reporting success here is the bug this whole task exists to fix — it is
    // what silently destroys the other person's work.
    const client = fakeClient(0)
    const result = await saveDesignSheet(client as never, {
      matterId: 'matter-1',
      expectedLockVersion: 3,
      fields: { concerns: 'updated' },
    })
    expect(result).toEqual({ ok: false, reason: 'stale' })
  })

  it('refuses a write with nothing in it', async () => {
    const client = fakeClient(1)
    await expect(
      saveDesignSheet(client as never, { matterId: 'matter-1', expectedLockVersion: 3, fields: {} }),
    ).rejects.toThrow(/nothing to save/i)
    expect(client.calls).toEqual([])
  })

  it('never lets a caller set lock_version itself', async () => {
    // The token is the database's to move. A caller that could set it could
    // defeat the check by passing the value it wants.
    const client = fakeClient(1)
    await expect(
      saveDesignSheet(client as never, {
        matterId: 'matter-1',
        expectedLockVersion: 3,
        fields: { lock_version: 99 } as Record<string, unknown>,
      }),
    ).rejects.toThrow(/lock_version/i)
    expect(client.calls).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test --workspace apps/workbench -- tests/design-sheet-persistence.test.ts`
Expected: FAIL — cannot resolve `@/lib/designSheet/persistence`.

- [ ] **Step 3: Write the implementation**

Create `apps/workbench/lib/designSheet/persistence.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkbenchDatabase } from '@/lib/supabase/database'

/**
 * Saving a design sheet without destroying somebody else's save.
 *
 * The root app's `saveLiDesignSheet` writes with no version check at all, so
 * two tabs open on one matter means the second save silently discards the
 * first — on a legal document.
 *
 * `lock_version` is the token: the caller passes the value it read, the update
 * matches on it and increments it. A save against a stale read matches no rows
 * and is reported, not swallowed.
 */

export interface SaveDesignSheetInput {
  matterId: string
  expectedLockVersion: number
  fields: Record<string, unknown>
}

export type SaveDesignSheetResult = { ok: true } | { ok: false; reason: 'stale' }

export async function saveDesignSheet(
  client: SupabaseClient<WorkbenchDatabase>,
  input: SaveDesignSheetInput,
): Promise<SaveDesignSheetResult> {
  if (Object.keys(input.fields).length === 0) {
    throw new Error('Nothing to save: an empty write would bump the lock and change no data')
  }
  if ('lock_version' in input.fields) {
    // The token is the database's to move. A caller able to set it could pass
    // whatever value it liked and defeat the check entirely.
    throw new Error('lock_version is not a field a caller may set')
  }

  const { data, error } = await client
    .from('design_sheets')
    .update({ ...input.fields, lock_version: input.expectedLockVersion + 1 })
    .eq('matter_id', input.matterId)
    .eq('lock_version', input.expectedLockVersion)
    .select('id')

  if (error) throw new Error(`Could not save design sheet ${input.matterId}: ${error.message}`)
  // Zero rows is not an error and is emphatically not success: the sheet moved
  // under us. The caller reloads and re-applies rather than overwriting.
  return (data?.length ?? 0) > 0 ? { ok: true } : { ok: false, reason: 'stale' }
}
```

- [ ] **Step 4: Run the tests, typecheck, lint**

```bash
npm run test --workspace apps/workbench -- tests/design-sheet-persistence.test.ts
npm run typecheck --workspace apps/workbench
npm run lint --workspace apps/workbench; echo "exit=$?"
```

Expected: 4 tests pass; typecheck clean; lint `exit=0`.

- [ ] **Step 5: Falsify the concurrency guard**

Change `.eq('lock_version', input.expectedLockVersion)` to `.eq('matter_id', input.matterId)` (i.e. drop the token from the match) and re-run. Expected: `reports a lost race` goes RED, because every write now matches. Restore and re-run.

- [ ] **Step 6: Commit**

```bash
git add apps/workbench/lib/designSheet/persistence.ts apps/workbench/tests/design-sheet-persistence.test.ts
git commit -m "A design-sheet write that cannot silently overwrite another

The caller passes the lock_version it read; the update matches on it and
increments it. Zero rows matched is a lost race, reported rather than
swallowed — reporting success there is what destroys the other person's
work.

A caller may not set lock_version, or it could pass the value it wants
and defeat the check.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Withdrawn — the intake bridge cannot be ported yet

**Attempted 2026-09-10 and stopped, deliberately.**

This task said to copy `lib/designSheet/seedFromIntake.ts` (305 lines) and
`lib/contacts/intakeFiduciarySnapshot.ts` (252) into the workbench verbatim,
fixing only import specifiers. That was wrong about the shape of the work.

Those two files stand on **eleven modules that do not exist under
`apps/workbench`**: `lib/queries`, `types/database`, `types/supabase`,
`lib/phone`, `lib/intakePlanType`, `lib/sharedFields`,
`lib/sharedFields/fiduciaries`, `lib/adminIntakeFiduciaries`,
`lib/designSheetImport/shared`, `lib/designSheet/buildInitialSheet` and
`lib/designSheet/seedCollegePrep`. Copying the files yields 12 `TS2307`
errors, one per unresolved import.

Some of the named helpers do exist in shared packages, at different paths —
`formatPhoneDisplay` in `packages/drafting-engine/src/phone.ts`,
`designSlotKeyForContactRole` and `normalizeCitizenshipStatus` in
`packages/estate-fields/src/core/` — and `joinFiduciaryName` exists in no
package at all. Repointing the imports at package copies that are *probably*
the same implementation is exactly the silent rewrite this task's own reason
forbids: the failure mode is not a crash, it is a document that is merely
wrong with a real client's name on it.

**Withdrawn from 6a rather than forced.** The bridge is only needed once
something in the workbench seeds a design sheet from intake, which is 6b's
work. What it actually requires first is the overhaul plan's own
*Shared-code extraction* — its own phase, not a step inside a persistence
change.

Tasks 1–4 are a complete phase without it: one home for the sheet, one safe
write path, and the audit reading where the data is.

### Task 5 (final): Apply, publish, and prove *(controller-only — not for a subagent)*

- [ ] **Step 1: Run every suite and open the PR**

```bash
npm test
npm run -w apps/workbench verify
npm run typecheck
npm run lint; echo "exit=$?"
git push -u origin claude/design-sheet-persistence
gh pr create --base main --title "Phase 6a: one home for the design sheet, and a safe write"
```

Wait for all four required checks to **appear and finish** before merging. Absence of the word "pending" is not completion — a check that has not registered looks identical to one that passed. A `CONFLICTING` PR runs no checks at all, because GitHub cannot build the merge commit.

- [ ] **Step 2: Apply both migrations**

The pooler is the only route from a worktree. Copy `.env.local` in only for the operation, remove it on exit including on failure, and never print the password.

```bash
WT=$(pwd)
cp /Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/.env.local "$WT/.env.local.tmp"
trap 'rm -f "$WT/.env.local.tmp"' EXIT INT TERM
PW=$(grep -m1 '^SUPABASE_DB_PASSWORD=' "$WT/.env.local.tmp" | cut -d= -f2- | tr -d '"')
PWE=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$PW")
D="postgresql://postgres.qifunlovuwaryzsyfbnh:${PWE}@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
unset PW PWE
# -1 wraps each file in a single transaction. It matters for the fold: its
# collision count and its merge are two statements, and without one
# transaction there is a wider window in which a concurrent save to one of
# those ten matters' residuary could be overwritten by the merge.
psql "$D" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261120000000_design_sheet_lock_version.sql
psql "$D" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261121000000_fold_li_design_sheet_data.sql

# Re-run the fold to prove it is a no-op rather than a failure. This
# repository re-applies migrations by hand when the history is not trusted,
# and a raise here would abort every migration behind it in the same push.
psql "$D" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/20261121000000_fold_li_design_sheet_data.sql
```

Verify from the catalog, never from `supabase_migrations.schema_migrations`:

```bash
psql "$D" -At -c "select count(*) from information_schema.columns where table_name='design_sheets' and column_name='lock_version';"
psql "$D" -At -c "select count(*) from public.design_sheets where decisions ? 'residuary_spouse_survives';"
```

Expected: `1`, and `10`.

- [ ] **Step 3: Regenerate the types**

`lock_version` is a new column, so `db-types-drift.yml` will fail until the generated types describe it.

```bash
npx supabase gen types typescript --db-url "$D" --schema public > /tmp/regen.ts
```

**The trap:** `--db-url` omits the `__InternalSupabase: { PostgrestVersion: "14.5" }` block that `--linked` emits and `tests/supabase-types-drift.test.ts` requires. Copy that block back in by hand from the current `packages/db-types/src/supabase.generated.ts` before overwriting it, then:

```bash
npm test -- tests/supabase-types-drift.test.ts
grep -c 'lock_version' packages/db-types/src/supabase.generated.ts   # expect >= 1
npm run typecheck
```

- [ ] **Step 4: Remove the type shims Task 4 needed**

`design_sheets.lock_version` did not exist in the generated types while Task 4
was written, so `apps/workbench/lib/designSheet/persistence.ts` carries two
narrow casts — a local `Update & { lock_version: number }` type, and
`'lock_version' as never` on the `.eq()` column argument.

Step 3 has just regenerated the types, so both are now unnecessary. **Delete
them and confirm `npm run typecheck --workspace apps/workbench` is still
clean.** A cast left behind after the reason for it is gone is the kind of
thing that survives for years and then hides a real error — and `as never` in
particular would silently accept a column name that no longer exists.

- [ ] **Step 5: Publish a prompt version carrying the new inputs**

The four `design_sheet.residuary_*` sources are now in the allow-list; a prompt version must declare them for the audit to receive them. Publish v10 of `ma-design-sheet-audit` as a copy of v9 with `residuary_spouse_survives` and `residuary_no_spouse` added to `inputs`, and to check 1's `reads`. Change no statement text — this version is about what the check can see, not what it asks.

Follow the shape of `supabase/migrations/20261116000000_design_sheet_audit_v9.sql`: insert into `prompt_versions`, then upsert `prompt_publications`.

- [ ] **Step 6: Measure what every allow-list source actually resolves to**

The bug this phase fixes was invisible to every gate the repo has, and it is
worth being precise about why: `unknownSources` checks only that a declared
source appears in `SOURCE_ALLOW_LIST`, and has no access to data.
`design_sheet.residuary_beneficiary` passed that check for weeks while naming
a column no row had ever populated.

Nothing catches that class of error automatically. Measurement does. For each
of the 35+ allow-list sources, count how many of the 44 latest design sheets
carry a non-empty value, and report the list of sources sitting at zero.

**Report the zero rows.** Each is either a field the intake genuinely has not
reached yet — which is fine and expected, per the ruling of 2026-09-10 — or
another input pointed at a place nothing writes. The two are indistinguishable
from inside the code, and only this table separates them.

- [ ] **Step 7: Prove the fix against the thing that motivated it**

Re-run check 1 on the seven matters whose findings were archived as false:
`0528d2db`, `10904a59`, `48aac2c1`, `590a0498`, `d11717cd`, `e10908ee`, `fadd6263`.

**Report the outcome honestly, either way.**
- If check 1 stops firing on matters that now resolve a residuary, the fix is demonstrated against the case that motivated it.
- If it still fires, the findings were real and this diagnosis was wrong. Record that; do not adjust the check to produce the expected answer.

---

## Verification against the spec

| spec requirement | task |
| --- | --- |
| add `lock_version`, defaulted | 1 |
| fold the ten blobs into `decisions` | 2 |
| refuse rather than merge on collision | 2 |
| do not drop `li_design_sheet_data` | 2 |
| allow-list resolves a key inside `decisions` | 3 |
| the select carries `decisions` | 3 |
| port persistence with compare-and-swap | 4 |
| a lost race is reported, not swallowed | 4 |
| port `seedFromIntake` + `intakeFiduciarySnapshot` verbatim | **withdrawn** — needs the shared-code extraction first, see Task 5 |
| remove Task 4's type shims once types are regenerated | final (Step 4) |
| measure every allow-list source against real data | final (Step 6) |
| re-run check 1 on the seven | final (Step 7) |
| out of scope: dropping the column, the sections, the drafting run | not implemented anywhere |
