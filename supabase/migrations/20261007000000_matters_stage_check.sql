-- `matters.stage` accepts any string, and a bad one disappears rather than erroring.
--
-- The column carries two vocabularies: the lead stages a row moves through
-- before it is hired, and the matter stages from `types/database.ts` STAGES
-- afterwards. Nothing has ever constrained it, so a typo or a retired stage key
-- writes cleanly and the row then fails the `stage_sla` join inside
-- `v_pipeline_aging` — which is an inner join, so the matter silently vanishes
-- from the aging board instead of showing up wrong. That failure mode is why
-- this is worth constraining: the damage is invisible.
--
-- Engine keys (`design_input`, `revisions`, `approved`, `closeout`,
-- `matter_closed`) are deliberately absent. They are the separate `stage_sla`
-- vocabulary that `map_matter_stage_to_engine()` maps these stages *onto*, and
-- they are never written back to this column.
--
-- Added NOT VALID so existing rows cannot fail the deploy, then validated in a
-- guarded block: if legacy rows hold a stage outside the list, the constraint
-- stays NOT VALID and still rejects every new bad write, and the warning names
-- the query that finds the offenders.

alter table public.matters
  drop constraint if exists matters_stage_check;

alter table public.matters
  add constraint matters_stage_check
  check (stage is null or stage in (
    -- Lead stages
    'new_lead',
    'discovery_call',
    'intake_sent',
    'intake_completed',
    'engagement_sent',
    -- Matter stages (types/database.ts STAGES)
    'intake',
    'intake_review',
    'design',
    'drafting',
    'client_review',
    'revision',
    'drafts_approved',
    'signing_scheduled',
    'signing_complete',
    'post_execution',
    'funding',
    'closed'
  )) not valid;

do $$
begin
  alter table public.matters validate constraint matters_stage_check;
exception when check_violation then
  raise warning
    'matters_stage_check left NOT VALID: rows hold a stage outside the known set. '
    'Find them with: select distinct stage from public.matters '
    'where stage is not null and not (stage in (...list from this migration...));';
end $$;

comment on constraint matters_stage_check on public.matters is
  'Lead stages plus the matter stages in types/database.ts STAGES. An '
  'unconstrained stage drops the matter from v_pipeline_aging via the stage_sla '
  'join, so it fails silently rather than loudly.';

notify pgrst, 'reload schema';
