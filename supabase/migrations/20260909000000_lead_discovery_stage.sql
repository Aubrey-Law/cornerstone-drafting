-- Cornerstone — a `discovery_call` lead stage.
--
-- A lead that had held its discovery call sat in `new_lead` — a 1-day attorney
-- SLA — until the organizer went out, so the aging board reported a breach for
-- work nobody was late on. Discovery existed only as an anchor column and three
-- tasks inside the `new_lead` phase; it had no stage of its own, and nothing
-- recomputed `matters.stage` when the anchor was set.
--
-- The clock is pinned to the call date rather than to the moment the booking is
-- recorded. `business_days_elapsed` generates an empty series for a future
-- start and returns 0, so a lead booked ahead reads green until the day of the
-- call and only then starts counting toward the post-discovery email.

-- ── The stage ───────────────────────────────────────────────────────────────

-- sla_days 1 matches the v3 plan: "Send post-discovery email (PMPS link +
-- estate plan organizer)" and "Determine fit" are both due at discovery_call+0.
insert into public.stage_sla
  (stage_key, track, entity, owner, sla_days, escalation_offset, stage_order)
values
  ('discovery_call', 'DEFAULT', 'lead', 'attorney', 1, 1, 2)
on conflict (stage_key, track) do update set
  entity      = excluded.entity,
  owner       = excluded.owner,
  stage_order = excluded.stage_order;

-- Renumber the stages discovery now sits ahead of. Only stage_order moves:
-- sla_days and escalation_offset are editable in Settings, and re-seeding them
-- with literals would silently revert whatever the firm had tuned them to.
update public.stage_sla set stage_order = 3
  where stage_key = 'intake_sent' and track = 'DEFAULT' and entity = 'lead';
update public.stage_sla set stage_order = 4
  where stage_key = 'intake_completed' and track = 'DEFAULT' and entity = 'lead';
update public.stage_sla set stage_order = 5
  where stage_key = 'engagement_sent' and track = 'DEFAULT' and entity = 'lead';
