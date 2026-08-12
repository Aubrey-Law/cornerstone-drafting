-- Cornerstone — revision comes before drafts_approved.
--
-- Three orderings described the same pipeline and one of them disagreed:
--
--   types/database.ts STAGES   client_review → drafts_approved → revision
--   pipeline_stage_rank()      client_review(110) → drafts_approved(120) → revision(130)
--   stage_sla (engine keys)    client_review(5) → revisions(6) → approved(7)
--
-- `stage_sla` had it right. The firm's sequence is that a client reviews the
-- drafts, asks for changes, and *then* approves; approval is the gate into
-- signing, not a station the matter passes through on its way to revisions.
-- `map_matter_stage_to_engine()` already carries drafts_approved → approved and
-- revision → revisions, so the two vocabularies were describing the same two
-- steps in opposite orders. This file moves the rank ladder onto stage_sla's
-- reading; STAGES and SLA_PHASES move with it in the same commit.
--
-- ── Why this is inert for every current caller ──────────────────────────────
--
-- `pipeline_stage_rank()` is compared in exactly three places, and all three
-- compare against 'intake_completed' (rank 30):
--
--   20260909000000  stamp_lead_pmps_stage   v_rank >= rank('intake_completed')
--   20260909000000  ensure_lead_matter      rank(v_stage) < rank('intake_completed')
--   20260911000000  ensure_lead_matter      rank(v_stage) < rank('intake_completed')
--
-- Nothing compares two matter stages to each other. Both stages moving here sit
-- far above 'intake_completed' either way, so no guard changes its answer and no
-- stage move that was forward becomes backward. In particular the routine case —
-- a client approves the drafts and then asks for one more change — is not gated
-- by this function at all.
--
-- The visible change is the matter-page stage strip, which renders STAGES in
-- order. On the SLA side the swap is invisible: `drafts_approved` is a review
-- checkpoint that carries no tasks (see 20260824000001), so it is filtered out
-- of the phase list before either the progress summary or the SLA tab groups by
-- phase.
--
-- ── The table ───────────────────────────────────────────────────────────────
--
-- This is 20260911000000's table with 120 and 130 exchanged; every other row is
-- unchanged, discovery_call included. As that file notes, the newest copy owns
-- the vocabulary — a stage added to an older copy has to be added here too or
-- this one drops it.

create or replace function public.pipeline_stage_rank(p_stage text)
returns integer
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case p_stage
    -- Lead stages
    when 'new_lead'          then 10
    when 'discovery_call'    then 15
    when 'intake_sent'       then 20
    when 'intake_completed'  then 30
    when 'engagement_sent'   then 40
    -- Matter stages
    when 'intake'            then 50
    when 'intake_review'     then 60
    when 'onboarding'        then 70  -- legacy v1
    when 'design'            then 80
    when 'drafting'          then 90
    when 'review'            then 100 -- legacy v1
    when 'client_review'     then 110
    when 'revision'          then 120
    when 'drafts_approved'   then 130
    when 'signing_scheduled' then 140
    when 'signing'           then 150 -- legacy v1
    when 'signing_complete'  then 160
    when 'post_execution'    then 170
    when 'post_signing'      then 180 -- legacy v1
    when 'funding'           then 190
    when 'closed'            then 200
  end
$$;

comment on function public.pipeline_stage_rank(text) is
  'Ordinal of a lead or matter stage in the unified pipeline order. Null for an unrecognised stage.';
