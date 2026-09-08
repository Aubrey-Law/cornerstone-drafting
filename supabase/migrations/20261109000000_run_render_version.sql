-- A run records which *render* produced it, not just which instruction text.
--
-- #424 added instructions_version, pinning the instruction text a run answers
-- against so that a retry weeks later asks the same question. That left four
-- pieces of the same question as un-versioned module code: the tool schema, the
-- tool name, the per-unit message wrapper, the input formatter and max_tokens.
-- All are read at the moment of the call, and the call can come much later --
-- retryFailedSteps sets failed steps back to pending and the next tick works
-- them against whatever is deployed then.
--
-- So the versioned unit widens from the instruction text to the whole render:
-- everything the code contributes to a unit's call, as one object per version
-- per kind in packages/citations. Versioned together rather than on separate
-- axes, because separate axes make combinations representable that never ran --
-- instructions v1 with tool v3 -- and replay would construct them while
-- reporting fidelity.
--
-- ADDITIVE, AND DELIBERATELY NOT A RENAME. Renaming instructions_version would
-- have been tidier and is what this was first designed as. Merging a migration
-- applies it automatically while Vercel ships the code on the same push
-- independently, so schema and code land in no guaranteed order -- and a rename
-- takes away the column the previous release is still selecting in
-- apps/workbench/lib/runs/context.ts. The rule is written in
-- supabase/migrations/README.md and in the deploy workflow's own header: add
-- nullable columns, backfill, and leave drops and renames until nothing reads
-- the old shape. So instructions_version stays, unused by new code, and a later
-- migration drops it.
--
-- Backfilled rather than left null, because the value is known and not guessed:
-- render version 1 *is* the render those rows were answered against, with
-- identical values. #424's migration refused to infer historical instruction
-- text from deploy timestamps; this infers nothing -- it is a copy.
--
-- Null keeps its meaning for anything that arrives without a version: the run
-- predates versioning, and a retry renders the current entry, which is what it
-- would have got anyway.
--
-- One column for both kinds. A render is per kind -- field_audit's is about
-- quoting design-sheet fields, review's about anchoring citations in a document
-- -- so `kind` and `render_version` together name one render, and a run has
-- exactly one kind.
--
-- What is deliberately NOT versioned: the gate. verifyFieldReference,
-- verifyQuote and the refusal of a finding with no references stay at current
-- code, because a run's question must not change after it opens while a run's
-- conclusion is allowed to improve. Versioning the gate would let a run opened
-- before a gate fix escape that fix on retry.

alter table public.workflow_runs
  add column if not exists render_version integer;

comment on column public.workflow_runs.render_version is
  'Which entry of the per-kind render registry in packages/citations produced '
  'this run -- instructions, tool schema, tool name, max_tokens, message '
  'wrapper and input formatter together. Null means the run predates the '
  'registry, in which case a retry renders the current entry. Read with '
  '`kind`, which selects the registry.';

-- Known, not guessed: render version 1 is exactly the render every existing
-- row was answered against.
update public.workflow_runs
   set render_version = instructions_version
 where render_version is null;

comment on column public.workflow_runs.instructions_version is
  'Superseded by render_version, which pins the whole render rather than the '
  'instruction text alone. Kept only so the previous release keeps working '
  'across the deploy; a later migration drops it once nothing reads it. Do '
  'not write it from new code.';

notify pgrst, 'reload schema';
