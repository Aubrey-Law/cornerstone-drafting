-- Cornerstone Lite — engagement/conflict override flags + overview editor gaps
-- The matter overview saves these via PATCH /api/admin/matter-details.
-- Portal archive: 20260609220000_matter_details_conflict_engagement_overrides.sql
--
-- conflict_cleared:    true  → force "Conflict cleared" pill
--                      false → force "Conflict pending"
--                      null  → fall back to conflict_check_completed
-- engagement_signed:   true  → force "Engagement signed" pill
--                      false/null → "Engagement pending"

ALTER TABLE public.matter_details
  ADD COLUMN IF NOT EXISTS conflict_cleared boolean,
  ADD COLUMN IF NOT EXISTS engagement_signed boolean,
  ADD COLUMN IF NOT EXISTS legal_plan_service_start date,
  ADD COLUMN IF NOT EXISTS legal_plan_service_end date,
  ADD COLUMN IF NOT EXISTS pb_inventory_due_date date;

NOTIFY pgrst, 'reload schema';
