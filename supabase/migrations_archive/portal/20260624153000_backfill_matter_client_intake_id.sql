-- Backfill matters.client_intake_id from the household intake row when a
-- converted matter lost the FK (e.g. admin intake saved via lead-only path).

UPDATE public.matters m
SET client_intake_id = ci.id
FROM public.client_intake ci
WHERE m.client_intake_id IS NULL
  AND m.lead_id IS NOT NULL
  AND ci.lead_id = m.lead_id;
