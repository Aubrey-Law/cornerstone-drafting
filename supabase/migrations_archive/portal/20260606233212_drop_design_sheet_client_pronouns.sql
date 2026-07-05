alter table public.client_intake
  add column if not exists preferred_pronoun text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'design_sheets'
      and column_name = 'client_pronouns'
  ) then
    update public.client_intake as intake
    set preferred_pronoun = design_sheet.client_pronouns
    from public.design_sheets as design_sheet
    where design_sheet.client_intake_id = intake.id
      and nullif(btrim(design_sheet.client_pronouns), '') is not null
      and nullif(btrim(intake.preferred_pronoun), '') is null;
  end if;
end $$;

alter table public.design_sheets
  drop column if exists client_pronouns;
