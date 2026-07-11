import { timingSafeEqual } from 'node:crypto'

/**
 * Compare the ?secret= carried on the registered webhook URL against the
 * configured shared secret. firma.dev webhooks are not signed, so this is
 * only the first gate — the handler re-fetches envelope state from the
 * provider API before acting on any event.
 */
export function verifyEsignWebhookSecret(candidate: string | null, secret: string): boolean {
  if (!candidate || !secret) return false
  const a = Buffer.from(candidate, 'utf8')
  const b = Buffer.from(secret, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
