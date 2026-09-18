/**
 * The caller's address, for rate-limit keys.
 *
 * Five call sites had written this out by hand before this file existed, and a
 * sixth was about to. The shape matters: `x-forwarded-for` is a comma-separated
 * chain and only the first entry is the client — reading the whole header, or
 * the last hop, keys the limit on a proxy that every caller shares.
 *
 * Takes `Headers` rather than a `Request` so a server component, which only has
 * `headers()`, can use the same derivation a route handler does.
 *
 * Falls back to a constant rather than to nothing: an unkeyable request still
 * has to consume *some* budget, or omitting the header would be the way past
 * every limit in the app.
 */
export function clientIpFrom(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || headers.get('x-real-ip')?.trim()
    || 'unknown'
}
