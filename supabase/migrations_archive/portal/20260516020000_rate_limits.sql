-- Postgres-backed rate limiter. Fixed-window counters keyed on (bucket, key).
-- Buckets are arbitrary route labels ('engagement_send', 'chat'); keys are
-- typically the auth user id.
--
-- The atomicity trick: SELECT ... FOR UPDATE inside a function. Concurrent
-- requests serialize on the row lock, so the count is exact under contention.
-- Postgres advisory locks would be cheaper but harder to inspect; for solo-
-- practice traffic volumes this is fine.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  bucket       text        NOT NULL,
  key          text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start
  ON public.rate_limits (window_start);

-- Take one token. Returns the new count after increment. Caller compares
-- against the per-bucket limit. Window is rolled forward atomically.
CREATE OR REPLACE FUNCTION public.rate_limit_consume(
  p_bucket          text,
  p_key             text,
  p_window_seconds  integer
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_window_start timestamptz;
  v_count        integer;
BEGIN
  -- Quantize "now" to the start of the current window so concurrent callers
  -- agree on the row key.
  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limits (bucket, key, window_start, count)
  VALUES (p_bucket, p_key, v_window_start, 1)
  ON CONFLICT (bucket, key, window_start)
  DO UPDATE SET count = public.rate_limits.count + 1
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$$;

-- GC for stale windows. Run from pg_cron or a periodic job.
CREATE OR REPLACE FUNCTION public.rate_limit_gc(p_max_age_hours integer DEFAULT 24)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.rate_limits
  WHERE window_start < now() - make_interval(hours => p_max_age_hours);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rate_limit_consume(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.rate_limit_gc(integer) TO service_role;

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies — service-role only.
