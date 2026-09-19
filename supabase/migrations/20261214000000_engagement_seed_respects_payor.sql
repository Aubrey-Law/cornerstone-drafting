-- The engagement fee seeder must not bill a client whose carrier is paying.
--
-- seed_engagement_billing_item is the only writer of billing_items.source =
-- 'engagement'. Its billing_type test gated only the milestone-schedule branch,
-- so a legal-plan matter failed that branch, fell through, and was charged a
-- direct-pay flat fee anyway. There was no guard of the form "a carrier pays
-- this matter, so do not seed a client fee".
--
-- In production it never got that far: billing_milestones_enabled is false, so
-- `coalesce(v_enabled, false)` short-circuits the whole condition and
-- billing_type is never evaluated at all. Seeding is currently blind to payor.
--
-- The inline list was also wrong on its own terms against MATTER_BILLING_TYPES
-- in lib/billing/billingType.ts: it omitted hyatt, legalshield and
-- other_legal_plan, and carried a 'legal_plan' entry that is not a member of
-- the union. That drift is why this adds a named predicate rather than a
-- fourth copy of the list.
--
-- Separately, 20260915000000 added a billing_item_deletions guard so that a
-- deleted engagement fee would not silently return; its header says so in as
-- many words. The 20261004000000 rewrite dropped the check while
-- delete_billing_items kept writing the tombstone, so deletions were recorded
-- and then ignored. Restored here.

-- Mirrors isLegalPlanBilling() in lib/billing/billingType.ts: null and
-- flat_fee are direct-pay, every other billing type means a carrier pays.
-- Adding a plan to the union needs no change here, which is the point.
create or replace function public.is_legal_plan_billing(p_billing_type text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select p_billing_type is not null
     and lower(btrim(p_billing_type)) not in ('', 'flat_fee');
$$;

comment on function public.is_legal_plan_billing(text) is
  'True when a matter is billed to a legal-plan carrier rather than the client. SQL mirror of isLegalPlanBilling() in lib/billing/billingType.ts.';

create or replace function public.seed_engagement_billing_item()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_enabled boolean := false;
  v_package_id uuid;
  v_item public.billing_items;
  v_area text;
begin
  if new.engagement_signed is not true or new.flat_fee_amount is null or new.flat_fee_amount <= 0
    or coalesce(new.fee_payment_status, 'unpaid') <> 'unpaid' then return new; end if;

  -- The payor decides whether a client fee exists at all. A carrier-billed
  -- matter is invoiced through a plan claim, never a direct-pay flat fee.
  if public.is_legal_plan_billing(new.billing_type) then return new; end if;

  -- A deleted engagement fee stays deleted. The trigger re-fires on any later
  -- write naming engagement_signed / flat_fee_amount / fee_payment_status, and
  -- the ON CONFLICT guard below only holds while the row still exists.
  if exists (
    select 1 from public.billing_item_deletions d
    where d.matter_id = new.client_id::uuid and d.source = 'engagement'
  ) then return new; end if;

  if exists (select 1 from public.billing_items where matter_id = new.client_id::uuid)
    or exists (select 1 from public.matter_fee_schedules where matter_id = new.client_id::uuid) then
    return new;
  end if;
  select billing_milestones_enabled into v_enabled from public.firm_settings where id = 1;
  v_area := case
    when upper(coalesce(new.practice_area, '')) in ('CP', 'COLLEGE PREP', 'COLLEGE PREPARATION') then 'CP'
    when upper(coalesce(new.practice_area, '')) = 'PROBATE' then 'Probate'
    else 'EP' end;
  -- No payor test here: the early return above already sent every carrier-billed
  -- matter home, so a second check could only drift away from the first.
  if coalesce(v_enabled, false) and v_area <> 'Probate' then
    select id into v_package_id from public.service_packages
      where practice_area = v_area and billing_strategy = 'fixed_milestones' and is_active
      order by created_at limit 1;
    if v_package_id is not null then
      perform public.create_matter_fee_schedule(
        new.client_id::uuid, v_package_id, round(new.flat_fee_amount * 100)::integer, null, null
      );
      return new;
    end if;
  end if;

  insert into public.billing_items (
    matter_id, kind, label, plan, amount_billed, status, invoiced_at, source, created_at, updated_at
  ) values (
    new.client_id::uuid, 'flat_fee',
    'Flat fee - ' || coalesce(nullif(btrim(new.plan_type), ''), nullif(btrim(new.practice_area), ''), 'Matter'),
    null, round(new.flat_fee_amount * 100)::integer, 'to_invoice', null, 'engagement',
    coalesce(new.engagement_signed_at, statement_timestamp()), statement_timestamp()
  ) on conflict (matter_id) where source = 'engagement' do nothing returning * into v_item;
  if v_item.id is not null then
    insert into public.billing_events (billing_item_id, event_type, detail, metadata)
    values (v_item.id, 'item_seeded', 'Engagement fee added to billing', jsonb_build_object('source', 'engagement'));
  end if;
  return new;
end $$;

-- trg_seed_engagement_billing_item on public.matter_details is unchanged and
-- still resolves this function by name, so it is deliberately not recreated.
