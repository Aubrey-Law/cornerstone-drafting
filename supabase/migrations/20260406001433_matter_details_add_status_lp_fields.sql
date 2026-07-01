ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS matter_status text;
COMMENT ON COLUMN public.matter_details.matter_status IS 'Internal matter status (e.g. active, on_hold, closed).';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS legal_plan text;
COMMENT ON COLUMN public.matter_details.legal_plan IS 'Legal plan provider or name for LP matters (e.g. MetLife, ARAG).';

ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS legal_plan_id text;
COMMENT ON COLUMN public.matter_details.legal_plan_id IS 'Member/case ID assigned by the legal plan provider.';;
