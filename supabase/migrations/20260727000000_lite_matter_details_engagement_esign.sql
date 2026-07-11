-- Engagement agreement e-signature state on matter_details.
-- One engagement per matter; re-sends overwrite engagement_envelope_id.
-- Provider-neutral by design (see the archived provider switch in
-- migrations_archive/portal/20260612170000_engagement_provider_external.sql):
-- envelope ids are text and engagement_provider records who signed it.
-- engagement_status: 'sent' | 'signed' | 'declined' (null = never sent).

ALTER TABLE public.matter_details
  ADD COLUMN IF NOT EXISTS engagement_provider    text,
  ADD COLUMN IF NOT EXISTS engagement_envelope_id text,
  ADD COLUMN IF NOT EXISTS engagement_status      text,
  ADD COLUMN IF NOT EXISTS engagement_sent_at     timestamptz,
  ADD COLUMN IF NOT EXISTS engagement_signed_at   timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS matter_details_engagement_envelope_id_idx
  ON public.matter_details (engagement_envelope_id)
  WHERE engagement_envelope_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
