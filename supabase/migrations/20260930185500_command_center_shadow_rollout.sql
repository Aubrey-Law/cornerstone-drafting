-- Keep the new home page opt-in while the shadow reconciliation runs. This
-- also corrects databases where the foundation migration was exercised before
-- its rollout-safe default was finalized.
alter table public.firm_settings
  alter column command_center_v2_enabled set default false;

update public.firm_settings
set command_center_v2_enabled = false
where command_center_v2_enabled is true;
