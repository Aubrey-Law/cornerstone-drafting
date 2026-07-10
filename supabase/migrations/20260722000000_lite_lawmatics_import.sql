-- Cornerstone Lite — Lawmatics OAuth tokens + import de-duplication keys

CREATE TABLE IF NOT EXISTS public.lawmatics_tokens (
  id            text PRIMARY KEY,
  access_token  text NOT NULL,
  refresh_token text,
  expires_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lawmatics_tokens ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS lawmatics_matter_id text;

CREATE UNIQUE INDEX IF NOT EXISTS client_intake_lawmatics_matter_id_key
  ON public.client_intake(lawmatics_matter_id)
  WHERE lawmatics_matter_id IS NOT NULL;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS lawmatics_contact_id text;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_lawmatics_contact_id_key
  ON public.contacts(lawmatics_contact_id)
  WHERE lawmatics_contact_id IS NOT NULL;

ALTER TABLE public.matter_details
  ADD COLUMN IF NOT EXISTS lawmatics_id text;

NOTIFY pgrst, 'reload schema';
