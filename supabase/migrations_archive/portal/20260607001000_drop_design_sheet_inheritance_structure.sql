do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'design_sheets'
      and column_name = 'inheritance_structure'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'design_sheets'
      and column_name = 'decisions'
  ) then
    update public.design_sheets
    set decisions = coalesce(decisions, '{}'::jsonb)
      || jsonb_build_object('legacy_inheritance_structure', inheritance_structure)
    where nullif(btrim(inheritance_structure), '') is not null
      and not (coalesce(decisions, '{}'::jsonb) ? 'legacy_inheritance_structure');
  end if;
end $$;

alter table public.design_sheets
  drop column if exists inheritance_structure;
