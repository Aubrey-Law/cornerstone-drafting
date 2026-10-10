-- Command Center is the Today home for new and existing firms.
-- Emergency rollback remains available from Settings → Command center.

alter table public.firm_settings
  alter column command_center_v2_enabled set default true;

update public.firm_settings
set
  command_center_v2_enabled = true,
  command_center_v2_enabled_at = coalesce(command_center_v2_enabled_at, now())
where command_center_v2_enabled is distinct from true;
