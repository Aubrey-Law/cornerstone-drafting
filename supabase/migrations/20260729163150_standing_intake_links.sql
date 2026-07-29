-- Stable, revocable intake links. The bearer URL is signed by the application;
-- only its public version nonce and lifecycle timestamps are persisted.
ALTER TABLE public.client_intake
  ADD COLUMN IF NOT EXISTS intake_link_version uuid,
  ADD COLUMN IF NOT EXISTS intake_link_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS intake_link_revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS client_intake_active_link_idx
  ON public.client_intake (id, intake_link_version)
  WHERE intake_link_version IS NOT NULL AND intake_link_revoked_at IS NULL;

COMMENT ON COLUMN public.client_intake.intake_link_version IS
  'Public nonce included in the application-signed standing intake URL. Rotate to invalidate prior links.';
COMMENT ON COLUMN public.client_intake.intake_link_revoked_at IS
  'When set, the current standing intake link is invalid.';

-- The public registration route calls this with the service-role client.
-- Remove the default PUBLIC execute grant so it is not itself an anonymous API.
REVOKE ALL ON FUNCTION public.rate_limit_consume(text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_consume(text, text, integer)
  TO service_role;

-- Seed a default only when the firm has not already configured one.
INSERT INTO public.email_templates (
  name, category, subject, body, is_active, is_default
)
SELECT
  'Complete your estate-planning intake',
  'intake_invite',
  'Complete your estate-planning intake',
  '<p>Hi {{first_name}},</p><p>Please use the secure link below to create or access your portal account and complete your intake questionnaire.</p><p><a href="{{intake_link}}">Complete your intake</a></p><p>You may return to this link until our office revokes or replaces it.</p>',
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates WHERE category = 'intake_invite' AND is_default
);

NOTIFY pgrst, 'reload schema';
