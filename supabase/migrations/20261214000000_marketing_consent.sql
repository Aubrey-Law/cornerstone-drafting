-- Rebuild a marketing consent record on `cornerstone_crm_people`.
--
-- 20261210000000 dropped nine consent columns and said why: the permission they
-- held was too old to act on, and "if marketing is ever rebuilt, consent starts
-- from nothing and has to be collected again". That is still the position. This
-- migration adds no data and back-fills nothing — every row starts at 'none'.
--
-- Four columns, not the previous nine. The five that are not coming back
-- (`marketing_segment`, `topic_preferences`, `preferred_frequency`,
-- `consent_captured_by`, `campaign_opt_out`) were all list-management state, and
-- list management now belongs to Loops rather than to this database:
--
--   Loops holds live subscription state — which lists someone is on, and whether
--   they are subscribed at all. It is the sender, so it has to.
--
--   These columns are the firm's own audit record: that permission was given,
--   where it came from, when, and when it was withdrawn. That is the part the
--   firm must be able to answer from its own records rather than from a vendor's
--   dashboard, which is why it is duplicated here at all.
--
-- `marketing_consent_status` rather than the old `marketing_status`: the name is
-- deliberately different so a query written against the destroyed column fails
-- loudly instead of silently reading a rebuilt one with no history behind it.

-- ── 1. The columns ──────────────────────────────────────────────────────────
-- 'none' is NOT NULL with a default so "we have no permission" is a stated fact
-- for every row rather than a NULL that could also mean "not yet migrated".
--
-- 'pending' exists for a double opt-in that was requested but never confirmed.
-- Nothing may be sent to a pending row; only 'subscribed' is permission.

alter table public.cornerstone_crm_people
  add column if not exists marketing_consent_status text not null default 'none',
  add column if not exists consent_source text,
  add column if not exists consent_captured_at timestamptz,
  add column if not exists unsubscribed_at timestamptz;

alter table public.cornerstone_crm_people
  drop constraint if exists cornerstone_crm_people_marketing_consent_status_check;

alter table public.cornerstone_crm_people
  add constraint cornerstone_crm_people_marketing_consent_status_check
  check (marketing_consent_status in ('none', 'pending', 'subscribed', 'unsubscribed'));

-- ── 2. Consistency the application cannot be trusted to hold ────────────────
-- A 'subscribed' row without a capture timestamp is unprovable permission, and
-- an 'unsubscribed' row without one cannot answer when the opt-out happened —
-- which is the question that matters if anyone ever asks why mail was sent.
-- Enforced here rather than in the route, because a second writer (a backfill,
-- a fix-up script, a future sync) will not remember.

alter table public.cornerstone_crm_people
  drop constraint if exists cornerstone_crm_people_consent_evidence_check;

alter table public.cornerstone_crm_people
  add constraint cornerstone_crm_people_consent_evidence_check
  check (
    (marketing_consent_status <> 'subscribed' or consent_captured_at is not null)
    and (marketing_consent_status <> 'unsubscribed' or unsubscribed_at is not null)
  );

-- ── 3. The index ────────────────────────────────────────────────────────────
-- Partial: almost every row is 'none' and nothing ever searches for those. The
-- queries that matter are "who may be sent to" and "who opted out".

create index if not exists cornerstone_crm_people_marketing_consent_status_idx
  on public.cornerstone_crm_people (marketing_consent_status)
  where marketing_consent_status <> 'none';

-- `v_cornerstone_crm_people` is deliberately left alone. 20261210000000 had to
-- drop and recreate it only because it selected four of the columns being
-- removed; it has no reader (lib/queries/cornerstoneCrm.ts reads the base
-- table), so adding these to it would widen a view nothing consumes.

notify pgrst, 'reload schema';
