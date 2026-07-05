-- Backfill matters.client_id from confirmed auth.users emails.
--
-- Some matters were created from leads before the auth user existed, so
-- client_id was left NULL and authorization fell back to email-matching on
-- v_matter_pipeline. The fallback path in userCanAccessMatter now backfills
-- this column opportunistically, but a one-shot backfill closes the loop
-- for matters whose owner never visited a page that triggers the auth check
-- (e.g. only ever receives email).
--
-- Idempotent: only updates rows where client_id IS NULL and we can find
-- exactly one confirmed auth user whose email matches the pipeline's
-- client_email. Ambiguous matches (two users with the same email — should
-- not happen given Supabase's auth.users.email uniqueness, but defensive)
-- are left NULL so they can be reviewed manually.

UPDATE public.matters m
SET client_id = u.id
FROM public.v_matter_pipeline p
JOIN auth.users u ON lower(u.email) = lower(p.client_email)
WHERE m.id = p.matter_id
  AND m.client_id IS NULL
  AND p.client_email IS NOT NULL
  AND u.email_confirmed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM auth.users u2
    WHERE lower(u2.email) = lower(p.client_email)
      AND u2.id <> u.id
      AND u2.email_confirmed_at IS NOT NULL
  );
