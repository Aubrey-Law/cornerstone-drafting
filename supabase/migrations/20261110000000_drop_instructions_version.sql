-- Drop workflow_runs.instructions_version, superseded by render_version.
--
-- #424 added it, pinning the instruction text a run answers against.
-- #426 widened the versioned unit from that text to the whole render --
-- instructions, tool schema, tool name, max_tokens, the per-unit message
-- wrapper and the input formatter -- and added render_version, backfilled from
-- this column because render version 1 *is* the render those rows were
-- answered against. #427 removed the last code that read or wrote this one.
--
-- STEP TWO OF TWO, AND THAT SPLIT IS THE POINT. A migration lands within a
-- minute or two of the code it ships with, in no guaranteed order, so a drop
-- must be safe against the release already serving. Shipping this alongside
-- #427 would have risked applying it while the previous release was still
-- selecting the column. #427 is deployed, nothing reads the column, and only
-- now is dropping it a no-op for every running version. The same rule --
-- supabase/migrations/README.md, and the deploy workflow's own header -- is
-- what turned #426 from a rename into an add, and what split this into two.
--
-- The data is not lost in any sense worth preserving: every row's
-- render_version was copied from this column, and the two were verified equal
-- for every row at the time (1 row, 0 differing, 0 null). No run has ever had
-- render_version null with this column set, so nothing was ever answered from
-- here that render_version cannot answer.

alter table public.workflow_runs
  drop column if exists instructions_version;

notify pgrst, 'reload schema';
