-- Give outstanding legacy intake invite tokens a real expiry.
--
-- Invite links were validated by SHA-256 hash (intake_token_hash) with an
-- expiry, but a legacy fallback matched the `intake_token` column with no
-- expiry — a long-lived-token hole. The route code now rejects expired (and
-- null-expiry) tokens, which would immediately invalidate every outstanding
-- legacy link. Those legacy tokens are UUIDs with a null expiry, so this
-- migration simply grants them a 14-day window: the route's legacy path keeps
-- validating them against this expiry, and they age out naturally afterward.
--
-- Intentionally NOT hashing + nulling the plaintext column: `intake_token` is a
-- uuid (not the base64url secret), and nulling it risked cutting off in-progress
-- intake links whose URL token casing might not match a backfilled hash. Leaving
-- the column in place keeps live links working while every token now expires.

UPDATE public.client_intake
SET intake_token_expires_at = now() + interval '14 days'
WHERE intake_token IS NOT NULL
  AND intake_token_expires_at IS NULL;
