-- Drop the campaign tables.
--
-- The last thing that wrote them went when the Mailgun machinery was removed:
-- the settings page, the cron dispatch, the webhook, the unsubscribe route and
-- `lib/crm/campaignDispatch.ts`. 20261210000000 then took the consent columns
-- these tables were the point of. Six tables, two functions and a trigger have
-- been sitting behind no reader since.
--
-- THIS DESTROYS THE SEND HISTORY. Which campaigns existed, who they went to,
-- what was delivered, opened, clicked, bounced or complained, and the
-- enrollment-time consent snapshot each recipient carried. Asked for
-- explicitly. There is no application left that can read any of it, and the
-- marketing consent it snapshotted is already gone.
--
-- `cornerstone_crm_sync_events` is deliberately untouched, including the held
-- outbound rows whose `entity_type` is 'campaign' or 'campaign_recipient'.
-- 20261008000000 left the equivalent opportunity rows alone when it retired
-- that mirror ("Existing held rows are left alone"), the outbox is its own
-- record rather than a campaign artefact, and the CRM sync page reads it.

-- ── 1. The tables ───────────────────────────────────────────────────────────
-- In reverse dependency order, so every foreign key is gone before the table
-- it points at. Deliberately without CASCADE: the order makes it unnecessary,
-- and CASCADE would silently take anything that turned out to reference these
-- tables without this migration having to say so. Verified first that nothing
-- outside this set does — every foreign key into them comes from another
-- campaign table, and no view selects from any of them.
--
-- Their indexes, CHECK constraints, RLS policies and triggers go with them.

drop table if exists public.cornerstone_crm_campaign_events;
drop table if exists public.cornerstone_crm_campaign_deliveries;
drop table if exists public.cornerstone_crm_campaign_dispatches;
drop table if exists public.cornerstone_crm_campaign_recipients;
drop table if exists public.cornerstone_crm_campaign_steps;
drop table if exists public.cornerstone_crm_campaigns;

-- ── 2. The functions ────────────────────────────────────────────────────────
-- AFTER the tables, and that order is load-bearing rather than tidy. A trigger
-- is dropped with its table but a trigger function is not, so these would
-- outlive every caller — and while the table still stands, its trigger is a
-- dependency Postgres refuses to drop the function out from under:
--
--   cannot drop function enforce_crm_recipient_snapshot_immutable() because
--   other objects depend on it (SQLSTATE 2BP01)
--
-- Putting the functions first, as the first draft of this migration did, fails
-- the whole migration on its first statement.
--
-- `emit_crm_outbox_event()` is NOT dropped and NOT rewritten: it still backs
-- `cornerstone_crm_people` and `cornerstone_crm_activities`. Its
-- `tg_table_name` CASE keeps arms for 'cornerstone_crm_campaigns' and
-- 'cornerstone_crm_campaign_recipients' that can no longer be reached — the
-- same dead arm 20261008000000 left behind for 'cornerstone_crm_opportunities'.
-- They compare a table name as text rather than resolving a table, so nothing
-- in the function breaks; rewriting a security-definer trigger that fires on
-- every person and activity write, for tidiness alone, is the larger risk.

drop function if exists public.enforce_crm_recipient_snapshot_immutable();
drop function if exists public.claim_crm_campaign_deliveries(uuid, integer);

notify pgrst, 'reload schema';
