-- Drop the retired CRM opportunity mirror.
--
-- `20261008000000_retire_crm_opportunity_mirror.sql` stopped this table being
-- written, removed its write-back loop into `client_intake` and `matters`, and
-- re-pointed its one application reader at `cornerstone_crm_people`. The table
-- was deliberately left in place: code and schema deploy in no guaranteed order
-- (supabase/migrations/README.md), so the release running at the time had to
-- keep finding it. Three releases have shipped since, nothing reads it, and this
-- removes it.
--
-- 20261008000000's header, and this table's COMMENT, both say a naive
-- `drop table ... cascade` would take all 235 CRM activity rows with it, via the
-- ON DELETE CASCADE foreign key on `cornerstone_crm_activities.opportunity_id`.
-- That is wrong, and testing this migration against a real Postgres is what
-- showed it: ON DELETE CASCADE is a row-level action that fires on DELETE, not
-- on DROP TABLE. Dropping the table drops the constraint; the rows survive.
--
-- The two things a naive cascade would actually do are still worth avoiding:
--
--   * It drops `v_cornerstone_crm_parity` outright — all four arms, three of
--     which have nothing to do with the mirror. Verified: after a bare
--     `drop table ... cascade`, that view is gone.
--   * It leaves `opportunity_id` behind as a column of dangling ids pointing at
--     a table that no longer exists, still named by a CHECK constraint.
--
-- And one thing this migration must do that the old note never mentioned: two
-- trigger functions still list `opportunity_id` in their INSERT column lists.
-- Dropping the column without rewriting them breaks **every `client_intake`
-- insert and every `lead_activity` insert in the app**. That is the real blast
-- radius here, and it is handled first.

-- ── 1. Stop the triggers naming the column ──────────────────────────────────
-- Both of these insert into `cornerstone_crm_activities` with `opportunity_id`
-- in the column list, passing an explicit null since 20261008000000. plpgsql
-- resolves the column at execution, so leaving them untouched would not fail the
-- migration — it would fail every lead write afterwards.

create or replace function public.sync_crm_person_from_intake()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_matter public.matters;
  v_stage_id uuid;
  v_person_id uuid;
begin
  if new.matter_id is not null then
    select * into v_matter from public.matters where id = new.matter_id;
  end if;

  select id into v_stage_id
  from public.cornerstone_crm_stages
  where slug = public.crm_stage_slug_for_intake(
    new.lead_status,
    new.status,
    new.intake_sent_at,
    new.intake_completed_at,
    new.engagement_status,
    new.engagement_sent_at,
    v_matter.relationship_status,
    v_matter.discovery_call_at,
    v_matter.pmps_at
  );

  insert into public.cornerstone_crm_people (
    source_system, lead_id, client_intake_id, person_kind, first_name, last_name,
    email, phone, city, state, lead_source, referral_source,
    owner_user_id, assigned_to_user_id, stage_id, stage_entered_at, sync_state
  ) values (
    'lead', new.id, new.id, 'primary', new.first_name, new.last_name,
    nullif(trim(new.email), ''), nullif(trim(new.phone), ''), new.city, new.state,
    new.lead_source, new.referral_source, new.user_id, new.user_id,
    v_stage_id, coalesce(new.updated_at, now()), 'pending'
  )
  on conflict (client_intake_id) where client_intake_id is not null do update set
    lead_id = excluded.lead_id,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    email = excluded.email,
    phone = excluded.phone,
    city = excluded.city,
    state = excluded.state,
    lead_source = excluded.lead_source,
    referral_source = excluded.referral_source,
    stage_id = excluded.stage_id,
    updated_at = now()
  returning id into v_person_id;

  if tg_op = 'INSERT' then
    insert into public.cornerstone_crm_activities (
      person_id, type, event_type, channel, direction,
      subject, performed_by_user_id, status, source, source_type,
      source_id, metadata, created_at, updated_at
    ) values (
      v_person_id, 'system', 'opportunity_created', 'internal', 'internal',
      'Opportunity created', new.user_id, 'done', 'cornerstone', 'client_intake',
      new.id::text, jsonb_build_object('client_intake_id', new.id),
      coalesce(new.created_at, now()), coalesce(new.created_at, now())
    ) on conflict (source_type, source_id) where source_type is not null and source_id is not null do nothing;
  end if;

  return new;
end
$$;

revoke all on function public.sync_crm_person_from_intake() from public, anon, authenticated;

create or replace function public.sync_crm_activity_from_lead_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_person_id uuid;
  v_actor_id uuid;
begin
  select id into v_person_id from public.cornerstone_crm_people where client_intake_id = new.lead_id;
  select id into v_actor_id from public.users where id = new.actor_id;
  if v_person_id is null then return new; end if;

  insert into public.cornerstone_crm_activities (
    id, person_id, type, event_type, channel, direction,
    subject, body, performed_by_user_id, status, source, source_type,
    source_id, metadata, created_at, updated_at
  ) values (
    new.id, v_person_id,
    case
      when new.event_type like 'email%' then 'email'
      when new.event_type like 'sms%' then 'sms'
      when new.event_type like '%meeting%' or new.event_type like '%consult%' then 'meeting'
      when new.event_type like '%note%' then 'note'
      when new.event_type in ('status_changed', 'converted') then 'status_change'
      else 'system'
    end,
    new.event_type,
    case when new.event_type like 'email%' then 'email' when new.event_type like 'sms%' then 'sms' when new.event_type like '%meeting%' or new.event_type like '%consult%' then 'meeting' else 'internal' end,
    case when new.event_type in ('email_sent', 'sms_sent') then 'outbound' when new.event_type = 'sms_received' then 'inbound' else 'internal' end,
    new.title, new.detail, v_actor_id, 'done', 'cornerstone', 'lead_activity',
    new.id::text, jsonb_build_object('legacy_lead_id', new.lead_id), new.created_at, new.created_at
  ) on conflict (id) do nothing;
  return new;
end
$$;

revoke all on function public.sync_crm_activity_from_lead_activity() from public, anon, authenticated;

-- ── 2. Release the activities table, and keep the guarantee it was carrying ──
--
-- The table's CHECK is `person_id is not null or opportunity_id is not null`, and
-- Postgres silently drops any constraint involving a dropped column. Dropping
-- `opportunity_id` on its own would therefore take that CHECK with it and leave
-- nothing at all requiring an activity to identify anyone. `person_id` is the
-- only meaningful identity now that the mirror is gone, so the guarantee is
-- restored in that form. Every existing row already satisfies it.

alter table public.cornerstone_crm_activities
  drop constraint if exists cornerstone_crm_activities_opportunity_id_fkey;

alter table public.cornerstone_crm_activities
  drop column if exists opportunity_id;

alter table public.cornerstone_crm_activities
  alter column person_id set not null;

comment on column public.cornerstone_crm_activities.person_id is
  'The person this activity belongs to. NOT NULL since 20261012000000, when the '
  'opportunity mirror was dropped and the old "person or opportunity" CHECK went '
  'with its column.';

-- ── 3. The dependent views ──────────────────────────────────────────────────
-- `v_cornerstone_crm_opportunities` has no reader anywhere and goes entirely.
-- `v_cornerstone_crm_parity` covers four entities and only one of them is the
-- mirror, so it is rebuilt without that arm rather than dropped.

drop view if exists public.v_cornerstone_crm_opportunities;

create or replace view public.v_cornerstone_crm_parity
with (security_invoker = true)
as
select 'intake_people'::text as entity,
  (select count(*) from public.client_intake)::bigint as source_count,
  (select count(*) from public.cornerstone_crm_people where client_intake_id is not null)::bigint as crm_count
union all
select 'contact_people',
  (select count(*) from public.contacts
    where trim(concat_ws(' ', first_name, last_name)) <> ''
      and lower(trim(concat_ws(' ', first_name, last_name))) not in ('tbd', 'to be determined')),
  (select count(*) from public.cornerstone_crm_people where contact_id is not null)
union all
select 'activities',
  (select count(*) from public.lead_activity),
  (select count(*) from public.cornerstone_crm_activities where source_type = 'lead_activity');

grant select on public.v_cornerstone_crm_parity to authenticated, service_role;

-- ── 4. The table ────────────────────────────────────────────────────────────
-- Deliberately not CASCADE. Everything known to depend on it has been removed
-- above, so anything still attached is something this migration did not account
-- for and the statement should fail loudly rather than quietly delete more.
-- Its indexes, RLS policies, grants and the `set_updated_at` trigger go with it.

drop table if exists public.cornerstone_crm_opportunities;

-- ── 5. The outbox rows it emitted ───────────────────────────────────────────
-- 415 `opportunity.*` events, all still `status = 'held'`, for a provider sync
-- that was never built. `entity_id` is a bare uuid with no foreign key, so these
-- never blocked the drop — they are removed because they now point at a table
-- that does not exist, and would otherwise render on the CRM sync page as
-- entries whose entity cannot be found.

delete from public.cornerstone_crm_sync_events where entity_type = 'opportunity';

notify pgrst, 'reload schema';
