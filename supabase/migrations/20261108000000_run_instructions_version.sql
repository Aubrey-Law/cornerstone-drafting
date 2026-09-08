-- A run records which instruction text produced it.
--
-- workflow_runs already pins prompt_version_id, and prompt_versions is
-- immutable, so that finishing a run means answering the same question it
-- originally asked. Half of what a check is asked sat outside that: the
-- instructions were a module constant in packages/citations, read at the
-- moment of the call.
--
-- And the call can come later. retryFailedSteps sets failed steps back to
-- pending and requeues the run; the tick then works them against whatever is
-- deployed. So a run started before an instruction change and retried after it
-- got a different question for the retried unit than its siblings answered,
-- with nothing recording the difference. The instructions changed twice in one
-- day while this was being built, and one of those changes turned out to
-- suppress a real finding -- so this is a measured hazard, not a hypothetical.
--
-- Nullable, and null means something specific: the run was made before the
-- instructions were versioned. It is not backfilled by guessing. git shows at
-- least three earlier variants of the text, but nothing records which one a
-- given historical run used, and inferring it from deploy timestamps would
-- produce a mapping that looks authoritative and is a guess. A null run falls
-- back to the current text -- what it would have got anyway -- and the null is
-- what lets that be reasoned about instead of discovered.
--
-- The one exception is knowable rather than guessed: the single run in the
-- database at the time of this migration was created under the present text,
-- so it is set to 1.
--
-- One column for both kinds. The instructions are per kind -- field_audit's
-- are about quoting design-sheet fields, review's about anchoring citations in
-- a document -- so `kind` and `instructions_version` together name one text,
-- and a run has exactly one kind.

alter table public.workflow_runs
  add column if not exists instructions_version integer;

comment on column public.workflow_runs.instructions_version is
  'Which entry of the per-kind instruction registry in packages/citations '
  'produced this run. Null means the run predates the registry, in which case '
  'a retry renders the current text -- see the registry''s own comment. Read '
  'with `kind`, which selects the registry.';

-- Knowable, not guessed: every run that exists now was made under version 1.
update public.workflow_runs set instructions_version = 1 where instructions_version is null;

notify pgrst, 'reload schema';
