-- PMPS billing: what the client was quoted, and which optional services.
--
-- The Estate Plan Proposal prints the legal plan, the flat fee and an Optional
-- Services table. The plan and the fee already live on matter_details; these
-- two did not, so the proposal always printed the firm's default add-on fees,
-- and nothing recorded whether the client had been quoted a fee at all — the
-- question the PMPS preflight exists to ask, because an unquoted client meets
-- their first written number in that table.
--
--   fee_quoted_date    when a fee was quoted to the client; null = not yet.
--   optional_services  the add-ons offered at the PMPS, as
--                      [{ service, description, fee, status }] with status
--                      'Recommended' or 'Optional'. Null means "use the firm
--                      defaults"; an empty array means "none offered".

ALTER TABLE public.matter_details
  ADD COLUMN IF NOT EXISTS fee_quoted_date date,
  ADD COLUMN IF NOT EXISTS optional_services jsonb;

ALTER TABLE public.matter_details
  DROP CONSTRAINT IF EXISTS matter_details_optional_services_is_array;

ALTER TABLE public.matter_details
  ADD CONSTRAINT matter_details_optional_services_is_array
  CHECK (optional_services IS NULL OR jsonb_typeof(optional_services) = 'array');

NOTIFY pgrst, 'reload schema';
