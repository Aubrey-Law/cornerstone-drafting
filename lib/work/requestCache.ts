type Entry<T> = { expiresAt: number; pending: Promise<T> }

const entries = new Map<string, Entry<unknown>>()

/**
 * Share one in-flight read across callers, and keep a successful result for
 * `ttlMs`. A rejection is dropped so the next caller can try again.
 *
 * Process-local on purpose: the work graph is large, and the Next.js data
 * cache rejects entries over 2MB. A short TTL bounds staleness on another
 * instance; writers call `invalidateWorkGraphCache` on this one.
 */
export function cachedRead<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  now = Date.now(),
): Promise<T> {
  const existing = entries.get(key) as Entry<T> | undefined
  if (existing && existing.expiresAt > now) return existing.pending
  const pending = load().catch(error => {
    const current = entries.get(key)
    if (current?.pending === pending) entries.delete(key)
    throw error
  })
  entries.set(key, { expiresAt: now + ttlMs, pending })
  return pending
}

/** Drop every cached work graph. The next read rebuilds it. */
export function invalidateWorkGraphCache(): void {
  entries.clear()
}
