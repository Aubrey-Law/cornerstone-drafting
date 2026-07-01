-- Schedule daily GC of the rate_limits table. Each call to
-- rate_limit_consume creates a window row keyed on (bucket, key,
-- window_start); old windows accumulate forever without cleanup.
--
-- rate_limit_gc(p_max_age_hours integer DEFAULT 24) was created in
-- 20260516020000_rate_limits.sql. This migration schedules it to run
-- nightly at 04:00 UTC.
--
-- Mirrors the email_log payload-purge pattern from 20260506000001:
-- check pg_cron is present, unschedule any prior job with the same
-- name (idempotent), then schedule fresh.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rate_limits_gc') THEN
      PERFORM cron.unschedule('rate_limits_gc');
    END IF;

    PERFORM cron.schedule(
      'rate_limits_gc',
      '0 4 * * *',
      $cron$SELECT public.rate_limit_gc(24)$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available — rate_limits_gc must be triggered manually or via app cron';
END$$;
