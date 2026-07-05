-- New intake step `additional_contacts` (numeric 8) inserted before fiduciaries.
-- Shift in-progress questionnaires that were saved at fiduciaries (8)+ so indices stay aligned.
UPDATE public.client_intake
SET current_step = current_step + 1
WHERE current_step >= 8
  AND COALESCE(status, '') NOT IN ('submitted', 'approved');
