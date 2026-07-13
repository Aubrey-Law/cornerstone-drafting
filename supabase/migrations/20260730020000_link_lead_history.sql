alter table public.matter_notes
  add column if not exists source_lead_note_id uuid references public.lead_notes(id);

create unique index if not exists matter_notes_source_lead_note_unique
  on public.matter_notes (source_lead_note_id)
  where source_lead_note_id is not null;

create or replace function public.preserve_matter_note_lead_provenance()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.source_lead_note_id is distinct from new.source_lead_note_id then
    raise exception 'Matter note lead provenance is immutable';
  end if;
  return new;
end
$$;

drop trigger if exists preserve_matter_note_lead_provenance on public.matter_notes;
create trigger preserve_matter_note_lead_provenance
  before update on public.matter_notes
  for each row execute function public.preserve_matter_note_lead_provenance();
