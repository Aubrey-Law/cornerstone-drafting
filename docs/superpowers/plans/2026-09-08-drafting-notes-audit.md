# Drafting-Notes Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second task-emitting prompt that reads the attorney's own `drafting_notes` against the structured decisions beside them, fired when those notes change rather than on stage entry.

**Architecture:** `prompt_stage_triggers` is generalised additively to carry a field trigger alongside a stage one — `to_stage` becomes nullable, `on_field` is added, a CHECK requires exactly one. A trigger on `design_sheets` records a notes change; the existing claim and materialise path drains it unchanged. See `docs/superpowers/specs/2026-09-08-drafting-notes-audit-design.md`.

**Tech Stack:** TypeScript, zod, vitest, Supabase Postgres (plpgsql), Next.js 16 App Router.

---

## Read this first

**Worktree.** Every command runs from
`/Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/.claude/worktrees/workbench-app-improvements-e03851`.
Never `cd` to the repository root — a different checkout. Never `git stash` — the stash
stack is shared; use a temporary commit. Branch is `claude/drafting-notes-audit`.

**Running tests.** Root and workbench are separate vitest *and* typecheck projects:

| What | Command |
| --- | --- |
| One workbench file | `cd apps/workbench && npx vitest run tests/<name>.test.ts` |
| Whole workbench suite | `cd apps/workbench && npx vitest run` |
| Workbench typecheck | `cd apps/workbench && npm run typecheck` |
| Root suite | `npx vitest run` |
| Root typecheck | `npm run typecheck` — **excludes `apps/`** |

`npx vitest run apps/workbench/tests/x.test.ts` from the repo root **matches no files and
exits 0**. Always read the reported counts. `packages/citations` has **no test runner of its
own**; its tests live in `apps/workbench/tests/`.

Baselines: root 459 files / 4873 passing / 1 skipped; workbench 86 files / 1099 passing;
both typechecks clean.

**This machine has been at load average 246 with memory pressure**, and vitest cannot always
spawn fork workers. If the root suite shows `Failed to start forks worker`,
non-deterministic counts, or collection errors, that is the environment — say so and let CI
arbitrate rather than chasing it.

**Client data is privileged.** Print counts, field keys, check numbers and matter ids —
never the contents of a client's notes, and never a fiduciary's name.

**Migrations to production.** The session-mode pooler is the only route from a worktree.
Copy `.env.local` in only for the operation, `rm -f` it immediately including on failure,
**never print or interpolate the password**, and verify applied objects from the catalog
(`pg_constraint`, `pg_trigger`, `information_schema`) — never from
`supabase_migrations.schema_migrations`, which has had phantom rows in this project.

---

## File structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20261106000000_field_change_triggers.sql` | Create: generalise the trigger table, add `prompts.fires_on_field_change`, add the `design_sheets` trigger. |
| `apps/workbench/tests/field-trigger-schema.test.ts` | Create: assert the migration's shape, as the sibling schema tests do. |
| `supabase/migrations/20261106010000_seed_drafting_notes_audit.sql` | Create: the prompt, version 1, its publication, and its watched field. |
| `apps/workbench/tests/drafting-notes-audit-content.test.ts` | Create: the seed's body parses, sources allow-listed, hash real, no v4 overlap. |

No app-code changes are expected. If you find one is needed, that is a finding — report it
before writing it.

---

### Task 1: the trigger table carries a field change

Additive on purpose. `to_stage` becomes nullable, `on_field` is added, a CHECK requires
exactly one of them, and **`stage_entered_at` keeps its name** — it now holds either a
stage's `stage_entered_at` or a notes-changed timestamp, and renaming it would mean
recreating the unique index backing a live queue's de-duplication for cosmetic gain. Its
comment is updated to say what it holds.

**Files:**
- Create: `supabase/migrations/20261106000000_field_change_triggers.sql`
- Test: `apps/workbench/tests/field-trigger-schema.test.ts`

- [ ] **Step 1: Read the two things this builds on**

```bash
sed -n '1,130p' supabase/migrations/20261103000000_stage_triggered_runs.sql
```

```bash
ls apps/workbench/tests/ | grep -iE "schema|trigger"
```

Read whichever schema test you find — Task 1's test should follow its conventions rather
than invent new ones. These tests assert the *migration file's* shape, so they pass before
the migration is applied.

- [ ] **Step 2: Write the migration**

```sql
-- A prompt can fire when a field changes, not only when a stage is entered.
--
-- Why not a second table: a field trigger's dedup key is
-- (matter_id, prompt_id, <the moment it fired>) -- the same shape as a stage
-- trigger's, with the same pending/claimed/done/skipped lifecycle and the same
-- drain path. Only the cause differs.
--
-- And the drain path already handles both, which was checked rather than
-- assumed: materialiseStageTrigger reads exactly id, matter_id and prompt_id
-- off a claimed row. It never reads to_stage, and nothing in the app does
-- outside one test fixture. So a field trigger becomes a run through existing
-- code with no change to it, and relaxing to_stage costs nothing.
--
-- This is the opposite call to the one made for the task emitters one slice
-- earlier, where planFiduciaryEmit was deliberately kept separate from
-- planEmit. Those two answer the same shape of question with different logic
-- over different sources. Here the logic is identical.

alter table public.prompt_stage_triggers
  alter column to_stage drop not null;

alter table public.prompt_stage_triggers
  add column if not exists on_field text;

-- Exactly one cause. A row with neither says nothing about why it exists; a row
-- with both would make the reason ambiguous to anyone reading it later.
alter table public.prompt_stage_triggers
  drop constraint if exists prompt_stage_triggers_one_cause;

alter table public.prompt_stage_triggers
  add constraint prompt_stage_triggers_one_cause
  check ((to_stage is null) <> (on_field is null));

-- The column's meaning is now wider than its name, and the name stays. It
-- holds whichever moment caused the row: a stage's stage_entered_at, or the
-- transaction timestamp of the edit that changed a watched field. Renaming it
-- would mean recreating the unique index that backs this queue's
-- de-duplication, on a working path, for cosmetic gain.
comment on column public.prompt_stage_triggers.stage_entered_at is
  'The moment that caused this trigger: a matter''s stage_entered_at for a '
  'stage trigger, or the transaction timestamp of the edit for an on_field '
  'trigger. Part of the uniqueness that de-duplicates two writes of the same '
  'change.';

comment on column public.prompt_stage_triggers.on_field is
  'The allow-listed source key whose change fired this, or null for a stage '
  'trigger. Exactly one of on_field and to_stage is set.';

-- What declares that a prompt watches a field. Nothing fires unless it says
-- so, so adding this changes nothing about the prompts that already exist.
alter table public.prompts
  add column if not exists fires_on_field_change text[] not null default '{}';

comment on column public.prompts.fires_on_field_change is
  'Allow-listed source keys (see packages/citations/src/prompt/inputs.ts) whose '
  'change fires this prompt. Deliberately not column names: a prompt author '
  'should not be able to widen what a prompt watches by typing.';

-- Fires on a real change to the notes, so re-saving a sheet that did not touch
-- them inserts nothing. An insert counts: a sheet created with notes already in
-- it has notes worth reading, and nothing else would ever notice.
--
-- now() is the dedup timestamp, not the sheet's updated_at. design_sheets has
-- no triggers at all and nothing maintains updated_at on update, so every edit
-- of a sheet would share one frozen insert-time value -- and the unique
-- constraint would have suppressed every re-audit after the first, forever,
-- while looking exactly like de-duplication working. now() is the transaction
-- timestamp: two writes in one transaction fire once, a later edit fires
-- again.
create or replace function public.trg_design_sheets_fire_field_prompts()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  insert into public.prompt_stage_triggers (matter_id, prompt_id, on_field, stage_entered_at, status)
  select new.matter_id, p.id, 'design_sheet.drafting_notes', now(), 'pending'
  from public.prompts p
  where 'design_sheet.drafting_notes' = any (p.fires_on_field_change)
  on conflict (matter_id, prompt_id, stage_entered_at) do nothing;
  return null;
end;
$$;

drop trigger if exists trg_design_sheets_fire_field_prompts on public.design_sheets;

create trigger trg_design_sheets_fire_field_prompts
  after insert or update of drafting_notes on public.design_sheets
  for each row
  when (new.drafting_notes is distinct from old.drafting_notes or old.id is null)
  execute function public.trg_design_sheets_fire_field_prompts();

notify pgrst, 'reload schema';
```

**One thing to check before applying:** an `after insert` trigger has no `OLD`, so
`old.id is null` in the `WHEN` clause may be invalid for the INSERT case — Postgres
evaluates `WHEN` per operation and `OLD` is not available on INSERT. If it errors, split
into two triggers (one `after insert`, one `after update of drafting_notes ... when (new.drafting_notes is distinct from old.drafting_notes)`)
sharing the same function. **Report which shape you ended up with and why.**

- [ ] **Step 3: Write the schema test**

Following the conventions of the sibling schema test you read, assert against the migration
file: `to_stage` is dropped to nullable, `on_field` is added, the one-cause CHECK exists with
the `<>` form, `fires_on_field_change` is added with a `'{}'` default, the trigger is
`after insert or update of drafting_notes`, the function inserts `now()` and not
`new.updated_at`, and the insert is `on conflict … do nothing`.

Add one test that would have caught the defect the design note records:

```ts
  /**
   * The first draft keyed de-duplication on the sheet's `updated_at`, which no
   * trigger maintains — so every edit of a sheet would share one frozen
   * insert-time value and the unique constraint would have suppressed every
   * re-audit after the first, forever, while looking exactly like
   * de-duplication working.
   */
  it('keys de-duplication on now(), never on the sheet’s updated_at', () => {
    expect(MIGRATION).toMatch(/select\s+new\.matter_id,\s*p\.id,\s*'design_sheet\.drafting_notes',\s*now\(\)/)
    expect(MIGRATION).not.toContain('new.updated_at')
  })
```

- [ ] **Step 4: Run the test, then apply**

```bash
cd apps/workbench && npx vitest run tests/field-trigger-schema.test.ts
```

Expected: PASS before applying, since it reads the file.

Then apply via the pooler and **verify from the catalog**: the CHECK from `pg_constraint`,
the trigger from `pg_trigger`, and both new columns from `information_schema.columns`.
Report what you actually saw.

- [ ] **Step 5: Prove the trigger fires, and does not over-fire — inside a rolled-back transaction**

Against the real database, because it is a database object. **But never commit a change to a
client's notes.** Do the whole proof inside a transaction and `rollback`: the trigger fires
within it, the rows are observable, and the rollback undoes both the note edit and the
trigger rows. Nothing is restored by hand because nothing is kept, which is strictly safer
than editing and putting back — a restore can fail, a rollback cannot leave half of it.

`now()` is the transaction timestamp, so everything in one transaction shares it. That is
fine for observing, and it is also what makes case 3 below meaningful.

Pick a hired matter with a design sheet. **Print no note content** — lengths and an md5 only.

```sql
begin;

-- 1. No prompt watches the field yet: a note change must fire nothing.
update public.design_sheets
   set drafting_notes = coalesce(drafting_notes, '') || ' x'
 where matter_id = '<matter>';
select count(*) as should_be_zero from public.prompt_stage_triggers where on_field is not null;

-- 2. Have one prompt watch it, then change the notes again.
update public.prompts
   set fires_on_field_change = array['design_sheet.drafting_notes']
 where slug = 'ma-design-sheet-audit';
update public.design_sheets
   set drafting_notes = coalesce(drafting_notes, '') || ' y'
 where matter_id = '<matter>';
select on_field, to_stage, count(*)
  from public.prompt_stage_triggers where on_field is not null group by 1, 2;

-- 3. Re-save without touching the notes: no new row. Same transaction, so the
--    dedup timestamp is identical anyway -- which is exactly why this case
--    needs the WHEN clause to be doing the work rather than the constraint.
--    Check the row count is unchanged, and note that this test cannot
--    distinguish "WHEN suppressed it" from "unique constraint suppressed it".
--    Say so, and prove the WHEN clause separately by updating an unrelated
--    column and confirming the trigger does not fire at all.
update public.design_sheets set state = state where matter_id = '<matter>';
select count(*) as unchanged from public.prompt_stage_triggers where on_field is not null;

rollback;
```

Then confirm the rollback took: zero `on_field` trigger rows, `fires_on_field_change` back
to `'{}'` on every prompt, and the sheet's `drafting_notes` md5 equal to what you recorded
before starting.

Report each case's result, and be explicit that case 3 inside one transaction cannot separate
the `WHEN` clause from the unique constraint — the unrelated-column update is what isolates
it.

- [ ] **Step 6: Commit**

Write the message yourself. It should say why one table rather than two, why `now()` rather
than `updated_at`, and why `stage_entered_at` keeps its name.

---

### Task 2: the prompt

**Files:**
- Create: `supabase/migrations/20261106010000_seed_drafting_notes_audit.sql`
- Test: `apps/workbench/tests/drafting-notes-audit-content.test.ts`

- [ ] **Step 1: Read the seeding shape for a new prompt**

```bash
sed -n '1,60p' supabase/migrations/20261028020000_seed_design_sheet_audit.sql
```

That seeds a **new** prompt: `prompts`, then `prompt_versions`, then `prompt_publications`.
Note its `on conflict … do nothing` on each insert, and that the publication insert for a
brand-new prompt does not need `do update` — there is no existing publication to repoint.

Read `packages/citations/src/prompt/inputs.ts`'s `SOURCE_ALLOW_LIST` for the exact source
keys, and `packages/citations/src/prompt/body.ts` for the body schema. **Every check's
`reads` must name a key one of the declared `inputs` provides**, or `superRefine` refuses
the body — so a successful parse is itself the proof.

- [ ] **Step 2: Write the seed**

Slug `ma-drafting-notes-audit`, title `Massachusetts drafting notes — contradiction check`,
kind `field_audit`, `outputTarget: 'checklist'`, `fires_on_field_change` =
`array['design_sheet.drafting_notes']`, and **`fires_on_stage_entry` left at its default
`'{}'`** — this prompt fires on the notes changing, never on a stage.

`drafting_notes` is `required: true`. A prompt whose whole subject is that field has nothing
to say without it, and the existing skip path already records a trigger whose inputs cannot
resolve as `skipped` with the reason rather than running it — measured working on a real
matter.

Four checks, the substance drafted in the design note's "The checks" section. Each statement
describes a contradiction between prose and a recorded decision; **none asserts a statute**,
consistent with v4's checks 1 to 4. Each needs a `taskTemplate` with a title, description
and priority.

Compute `content_hash` as **sha256 of the body JSON with SQL's doubled single quotes
collapsed back to single ones** — the form v3 of the audit's own stated hash matches. Compute
it with a script from the body you actually seed; do not type it.

- [ ] **Step 3: Write the content test**

Follow `apps/workbench/tests/design-sheet-audit-content.test.ts`'s conventions — it has one
`describe` per seeded version. Assert: the body parses; `outputTarget` is `checklist`;
`unknownSources(parsed.inputs)` is empty; the stated hash is the real sha256; check numbers
are unique; `drafting_notes` is a required input; and the prompt declares
`fires_on_field_change` and **not** `fires_on_stage_entry`.

Plus the overlap guard the design note asks for:

```ts
  /**
   * v4 of the design-sheet audit asks whether a person *named* in free text
   * appears in the structured decisions. This asks whether an *instruction
   * about* a fiduciary is reflected — a note saying the trustee should act
   * only with a co-trustee is not a missing person, and v4 would pass it. The
   * boundary is deliberate, so it is asserted: no check here may have a
   * `reads` set identical to a v4 check's.
   */
  it('does not restate a check version 4 already makes', () => {
    // …compare the two migrations' parsed bodies by `reads` set equality…
  })
```

- [ ] **Step 4: Run the test, then apply and verify**

```bash
cd apps/workbench && npx vitest run tests/drafting-notes-audit-content.test.ts
```

PASS before applying. Then apply, and verify **from the database**: the published version's
`outputTarget`, its check count, and that `fires_on_field_change` holds the one key. Report
what you saw.

- [ ] **Step 5: Commit**

Write the message yourself, saying what the prompt asks that v4 does not, and why it fires
on the notes changing rather than on a stage.

---

### Task 3: verify

- [ ] **Step 1: Both projects**

```bash
npm run typecheck && npx vitest run
```

```bash
cd apps/workbench && npm run typecheck && npx vitest run
```

- [ ] **Step 2: The live checks**

New columns are read by nothing in app code yet, but the RPC and column checkers should still
pass:

```bash
cd apps/workbench && npx vitest run tests/query-columns.test.ts
```

```bash
cp /Users/scottaubrey/Desktop/GitHub/cornerstone-drafting/.env.local .env.local.tmp
set -a && . ./.env.local.tmp && set +a
node scripts/checkDbColumns.mjs && node scripts/checkDbRpcs.mjs
rm -f .env.local.tmp
```

- [ ] **Step 3: Open the PR**

```bash
git push -u origin claude/drafting-notes-audit
```

State: why stage entry was the wrong trigger, measured (3 of 44 sheets, none in the firing
stages); why one trigger table; why `now()`; and that this is the first real exercise of
#419's cross-prompt scoping. Include the
`🤖 Generated with [Claude Code](https://claude.com/claude-code)` trailer.

---

### Task 4: the real run, and the coexistence test this slice exists to make possible

**Do not merge without showing the owner the check statements first.** They encode judgment
about their own practice, and the design note says their sign-off is needed before
publication.

- [ ] **Step 1: After merge and deploy, fire it**

Pick a hired matter that **has** non-empty `drafting_notes`. Re-measured 2026-09-08 and
unchanged from when this plan was written: **3 of 44 sheets**, all `hired`, at `revision`
(194 characters), `client_review` (439) and `drafts_approved` (499). Record the notes'
length and hash first, never the content.

That 3-of-44 sparsity is not an argument against the prompt — it is the argument *for*
the field-change trigger, and re-measuring strengthened it. None of the three stages is
in the audit's `{design,drafting}`, so a stage-entry prompt would never reach any sheet
that actually has notes. A change-triggered prompt fires when the attorney writes them,
which is the only moment the notes are worth reading. Touch the notes to fire the trigger (an idempotent rewrite of the same value will
**not** fire it, by design — so make a real, reversible edit, or set them to their own value
plus a trailing space and restore after).

Report: the trigger row, the run's per-check outcomes with reference counts, and the task it
produced.

- [ ] **Step 2: The coexistence test**

This is the point. Get **both** prompts to have a task on one matter, then re-run each.

**Getting there needs one step the plan originally assumed away.** Re-measured
2026-09-08, after the render-versioning slice: the three notes-bearing matters sit at
`revision`, `drafts_approved` and `client_review`, and the design-sheet audit's
`stages` and `fires_on_stage_entry` are both `{design,drafting}`. The sets are
**disjoint** — `stage = any(p.stages)` is false for all three — so the audit has never
run on any of them (0 runs; 1 audit run exists in the whole database, on a `drafting`
matter). Waiting for both prompts to hold a task on one matter naturally will never
happen.

So queue the audit deliberately, on whichever of the three you fire the notes prompt
against: **run `ma-design-sheet-audit` against that matter from `/prompts`.**
`runMatterAudit` applies no stage filter — stage entry is one way in, an attorney's
choice on that page is the other, and both land in the same queue — so this is the
supported path rather than a fixture, and it is the same route the attorney would use.

Two alternatives were considered and rejected. Adding those stages to the audit's
`stages` array changes what the audit does across every matter, which is the owner's
judgment and not a test's to make. Writing notes onto a `design` or `drafting` matter
means inventing the attorney's own words in a real client's sheet, and those words are
the entire subject of the prompt.

Then, with both tasks present:

- the design-sheet audit's task must survive the drafting-notes prompt's run
- the drafting-notes prompt's task must survive the audit's run
- neither may be archived with `closeout_reason = 'prompt_superseded'` by the other

Report the tags, and which prompt each resolves to. Before #419 the second run would have
archived the first prompt's task; that is the property finally being exercised against real
data rather than a fake client.

- [ ] **Step 3: Confirm nothing else moved**

The `sla`, `manual` and `fiduciary` task counts must be unchanged. Report before and after.

---

## Out of scope, named

**Renaming `stage_entered_at`.** Considered and declined in the design note.

**Watching any field but `drafting_notes`.** The column is an array and the trigger is
per-column, so a second watched field means a second database trigger. One is enough to
learn from.

**The verification drift** on the design-sheet audit — five runs, still unexplained.
