-- Phase 1 of moving portal access from client_intake to the contact level.
-- Lets the attorney enable/disable a portal account on any contact (spouse,
-- adult child, professional contact, etc.), independent of the matter.
-- The deeper contact↔matter join + permission flags are deferred to Phase 2.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS portal_enabled    boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS portal_user_id    uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS portal_invited_at timestamptz;

COMMENT ON COLUMN public.contacts.portal_enabled    IS 'When true, this contact has been granted portal access. Disable to revoke without deleting the auth user.';
COMMENT ON COLUMN public.contacts.portal_user_id    IS 'Auth user linked to this contact, set when the contact accepts the portal invite and signs in.';
COMMENT ON COLUMN public.contacts.portal_invited_at IS 'Timestamp of the most recent portal invite sent to this contact.';

CREATE INDEX IF NOT EXISTS idx_contacts_portal_user_id ON public.contacts (portal_user_id);
