import { getAdminClient } from '@/lib/supabaseAdmin'

export interface RateLimitConfig {
  /** Logical bucket name — also the rate_limits.bucket column value. */
  bucket: string
  /** Max requests allowed per window. */
  limit: number
  /** Window length in seconds. */
  windowSeconds: number
}

export interface RateLimitResult {
  ok: boolean
  /** Count after this attempt (whether or not it was allowed). */
  count: number
  limit: number
  /** Seconds until the current window closes. */
  retryAfterSeconds: number
}

/**
 * Consume one token from a fixed-window rate limit bucket. Returns
 * `ok: false` when the caller has already exceeded `limit` in the current
 * window — the row is still incremented so we observe abuse.
 *
 * Failure modes: if the RPC errors, we fail OPEN (return ok: true). The
 * alternative — failing closed — turns a Supabase blip into an outage on
 * every rate-limited route. Tradeoff is explicit and acceptable for beta.
 */
export async function consumeRateLimit(
  cfg: RateLimitConfig,
  key: string,
): Promise<RateLimitResult> {
  const admin = getAdminClient()
  const { data, error } = await admin.rpc('rate_limit_consume', {
    p_bucket: cfg.bucket,
    p_key: key,
    p_window_seconds: cfg.windowSeconds,
  })

  if (error) {
    console.error('[rateLimit] RPC error — failing open:', error.message)
    return { ok: true, count: 0, limit: cfg.limit, retryAfterSeconds: 0 }
  }

  const count = typeof data === 'number' ? data : Number(data ?? 0)
  const ok = count <= cfg.limit
  const now = Math.floor(Date.now() / 1000)
  const windowStart = Math.floor(now / cfg.windowSeconds) * cfg.windowSeconds
  const retryAfterSeconds = ok ? 0 : windowStart + cfg.windowSeconds - now

  return { ok, count, limit: cfg.limit, retryAfterSeconds }
}
