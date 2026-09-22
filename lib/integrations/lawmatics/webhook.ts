import { createHmac, timingSafeEqual } from 'node:crypto'

/** Deliveries older (or newer) than this are rejected as possible replays. */
export const LAWMATICS_WEBHOOK_TOLERANCE_SECONDS = 5 * 60

/**
 * Verify a Lawmatics outbound webhook.
 * X-Lawmatics-Signature = "sha256=" + hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)),
 * where the secret is the full `whsec_…` string and timestamp is
 * X-Lawmatics-Timestamp (Unix seconds).
 */
export function verifyLawmaticsSignature(input: {
  rawBody: string
  secret: string
  signature: string | null
  timestamp: string | null
  nowSeconds?: number
}): boolean {
  const { rawBody, secret, signature, timestamp } = input
  if (!secret || !signature || !timestamp || !/^\d+$/.test(timestamp)) return false
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - Number(timestamp)) > LAWMATICS_WEBHOOK_TOLERANCE_SECONDS) return false
  if (!signature.startsWith('sha256=')) return false

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
  const supplied = signature.slice('sha256='.length)
  if (supplied.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

/** Form submissions are the only deliveries that can mean a new booking. */
export function isFormSubmissionEvent(eventType: unknown): boolean {
  return typeof eventType === 'string' && /^form[._]/i.test(eventType) && /submi(t|ssion)/i.test(eventType)
}
