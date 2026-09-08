-- The design-sheet audit fires on the stages where its findings can still be acted on.
--
-- It fired on {design, drafting}, which reaches 6 of 44 design sheets. Most
-- matters are further along -- 19 sheets sit at client_review alone -- so the
-- audit was running against a small corner of the practice, and has in fact
-- run once in its life.
--
-- Adds client_review, revision and drafts_approved: the stages where the sheet
-- is complete enough to audit and the drafting can still change in response.
--
-- WHAT IS DELIBERATELY LEFT OUT, both for the same reason -- a finding nobody
-- can act on is worse than no finding, because the audit reports at blocker
-- severity and has already produced two blocker-level false positives on a
-- well-drafted matter:
--
--   intake, intake_completed -- the sheet is incomplete by definition here, so
--     the audit would report absences that are literally true and entirely
--     premature. "The disinheritance language is missing" is not news on a
--     sheet the attorney has not finished writing.
--
--   signing_scheduled, signing_complete, post_execution -- the documents are
--     executed or about to be. A design-sheet finding at that point cannot be
--     closed by fixing anything, so it becomes a task that can only be
--     dismissed.
--
-- PROSPECTIVE ONLY, WHICH IS WHY THIS IS SAFE. The trigger in
-- 20261103000000_stage_triggered_runs.sql is `after update of stage ... when
-- (new.stage is distinct from old.stage)`, so it fires on a transition *into*
-- a stage. The 26 sheets already sitting in the three new stages do not fire;
-- the next matter to move into one does. So this queues nothing now, spends
-- nothing now, and is reversible by narrowing the array again.
--
-- Configuration, not content, so it changes no prompt version: the same rule
-- 20261104000000 states -- fires_on_stage_entry decides *when* a prompt runs,
-- and the version body decides what it asks. A run stays reproducible because
-- its prompt_version_id and render_version are untouched by this.
--
-- prompts.stages is left alone on purpose. It is read by nothing -- no select
-- list in the workbench includes it -- so widening it would look like a change
-- and be inert. Naming that here so the next person does not assume the two
-- arrays work together.

update public.prompts
   set fires_on_stage_entry = array['design', 'drafting', 'client_review', 'revision', 'drafts_approved']
 where slug = 'ma-design-sheet-audit';

notify pgrst, 'reload schema';
