-- Lead pipeline status on client_intake. NULL = not a lead (matter-origin
-- intake, e.g. direct Create Matter or Lawmatics import); the Leads page
-- shows only rows where lead_status IS NOT NULL.
--   'lead'  = open lead (default on lead creation)
--   'hired' = converted to a matter (set automatically on conversion)
--   'lost'  = did not engage

ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS lead_status text;
CREATE INDEX IF NOT EXISTS client_intake_lead_status_idx
  ON public.client_intake (lead_status)
  WHERE lead_status IS NOT NULL;
NOTIFY pgrst, 'reload schema';
