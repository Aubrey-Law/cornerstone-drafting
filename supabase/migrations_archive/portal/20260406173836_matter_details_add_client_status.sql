ALTER TABLE public.matter_details ADD COLUMN IF NOT EXISTS client_status text;
COMMENT ON COLUMN public.matter_details.client_status IS 'Client relationship status: hired, lead, active, inactive. Synced from matters.status.';;
