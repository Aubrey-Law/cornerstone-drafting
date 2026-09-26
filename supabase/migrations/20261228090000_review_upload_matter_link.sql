-- Linking an unfiled upload to a matter after the fact.
--
-- A prior plan often arrives before there is a matter for it: a prospective
-- client brings in the will another firm drafted, it is reviewed, and weeks
-- later they hire the firm. The upload and its reviews then belong with that
-- matter. This records the link on the upload itself.
--
-- The link lives on `review_uploads`, deliberately not on the upload's review
-- runs: `workflow_runs.matter_id` stays null for them (as
-- 20261227090000_review_uploads.sql allows). The run advisory groups runs by
-- (matter, prompt) to find each matter's latest review, and a review of
-- another attorney's plan must never stand in for the review of the firm's own
-- draft of that matter. Anything that wants "this matter's prior plans" reads
-- the link here.
--
-- Additive only: a nullable column, its stamp, and a check that the two agree.

alter table public.review_uploads
  add column if not exists matter_id uuid references public.matters(id) on delete set null;

alter table public.review_uploads
  add column if not exists linked_at timestamptz;

alter table public.review_uploads
  add column if not exists linked_by uuid references public.users(id) on delete set null;

create index if not exists review_uploads_matter_idx on public.review_uploads (matter_id);

-- A link always says when it was made, and an unlinked upload carries no stale
-- stamp. `on delete set null` on the matter clears matter_id alone, so the
-- stamp is cleared with it by the trigger below rather than tripping this.
alter table public.review_uploads
  drop constraint if exists review_uploads_link_stamped;
alter table public.review_uploads
  add constraint review_uploads_link_stamped
    check ((matter_id is null) = (linked_at is null));

create or replace function public.review_uploads_clear_link_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.matter_id is null then
    new.linked_at := null;
    new.linked_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists review_uploads_clear_link_stamp on public.review_uploads;
create trigger review_uploads_clear_link_stamp
  before update of matter_id on public.review_uploads
  for each row execute function public.review_uploads_clear_link_stamp();
