-- Cornerstone — the columns the matter page still had nowhere to put.
--
-- Most of the matter-page gap analysis turned out to be a UI problem: county,
-- the drafting dates, funding status and special provisions all had columns
-- already. This is the remainder — the fields that genuinely had none.
--
-- Two naming notes, both deliberate:
--   * the design calls the contacts table `matter_contacts`; here it is
--     `contacts`, keyed on client_intake_id. Same table, existing name kept.
--   * `billing_type` was free text overlapping a second free-text `legal_plan`
--     column. It becomes the one enum for how a matter is paid; `legal_plan`
--     survives as the display name derived from it, so nothing that reads
--     `legal_plan` today breaks.

alter table public.matter_details
  add column if not exists referral_source_other       text,
  add column if not exists ep_has_real_estate          boolean default false,
  add column if not exists ep_has_pets                 boolean default false,
  add column if not exists ep_anticipated_inheritance  boolean default false,
  add column if not exists ep_accounts_retitled        boolean default false,
  add column if not exists legal_plan_member_id        text,
  add column if not exists claim_amount                numeric,
  add column if not exists claim_submitted_date        date,
  add column if not exists reimbursement_received_date date,
  add column if not exists payment_link_sent_at        timestamptz,
  add column if not exists work_started_date           date,
  add column if not exists work_finished_date          date,
  add column if not exists closing_package_sent_date   date,
  add column if not exists next_action_date            date;

alter table public.contacts
  add column if not exists from_prior_relationship boolean default false;

comment on column public.matter_details.claim_amount is
  'What the plan is expected to pay. Flat-fee matters leave this null.';
comment on column public.matter_details.next_action_date is
  'Drives the header pill and the weekly ops board.';
comment on column public.contacts.from_prior_relationship is
  'Child of a prior relationship — changes the residuary and guardian analysis.';

-- ── billing_type becomes the enum ───────────────────────────────────────────
--
-- Map what is already stored. Historic values arrived from Lawmatics imports
-- and hand typing, so match case-insensitively on a substring.
--
-- What we cannot identify, we do not guess at. Roughly nineteen live rows carry
-- an unresolved Lawmatics option ID in legal_plan ('570648' and friends) rather
-- than a plan name: custom_field_613309 came back as the dropdown's ID instead
-- of its label. Calling those 'other_legal_plan' would give each matter a claim
-- block it may not have and hold its close-out behind claim gates that can
-- never be satisfied. They keep a null billing_type and their raw legal_plan
-- value, read as "Not set" in the Billing tab, and get classified by hand.

update public.matter_details
set billing_type = case
  when billing_type ilike '%metlife%'      or legal_plan ilike '%metlife%'      then 'metlife'
  when billing_type ilike '%legalease%'    or legal_plan ilike '%legalease%'    then 'legalease'
  when billing_type ilike '%arag%'         or legal_plan ilike '%arag%'         then 'arag'
  when billing_type ilike '%hyatt%'        or legal_plan ilike '%hyatt%'        then 'hyatt'
  when billing_type ilike '%legalshield%'  or legal_plan ilike '%legalshield%'  then 'legalshield'
  when billing_type ilike '%legal shield%' or legal_plan ilike '%legal shield%' then 'legalshield'
  -- Free text that says "plan" without naming one is still a plan matter.
  when billing_type ilike '%plan%'                                              then 'other_legal_plan'
  when billing_type ilike '%flat%'                                              then 'flat_fee'
  -- Everything else — including the numeric IDs — stays unclassified. Note this
  -- also clears any unrecognised free text out of billing_type, which the check
  -- constraint below would otherwise reject.
  else null
end
where billing_type is not null
   or coalesce(trim(legal_plan), '') <> '';

alter table public.matter_details
  drop constraint if exists matter_details_billing_type_check;

alter table public.matter_details
  add constraint matter_details_billing_type_check
    check (billing_type is null or billing_type in (
      'flat_fee', 'metlife', 'legalease', 'arag', 'hyatt', 'legalshield', 'other_legal_plan'
    ));

-- legal_plan is now the display name of billing_type, not a parallel truth —
-- but only where billing_type actually resolved. An unclassified row keeps the
-- raw value it came in with, so the Lawmatics ID is still there to look up.
update public.matter_details
set legal_plan = case billing_type
  when 'metlife'          then 'MetLife'
  when 'legalease'        then 'LegalEASE'
  when 'arag'             then 'ARAG'
  when 'hyatt'            then 'Hyatt'
  when 'legalshield'      then 'LegalShield'
  when 'other_legal_plan' then coalesce(nullif(trim(legal_plan), ''), 'Other legal plan')
  else null
end
where billing_type is not null;

notify pgrst, 'reload schema';
