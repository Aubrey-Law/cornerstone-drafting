import { createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_TOLERANCE_SECONDS = 5 * 60

/**
 * Resend signs webhooks with the Svix scheme. Three headers travel with each
 * delivery and all three are part of the signed content, so a replayed body
 * cannot be re-pointed at a different id or timestamp.
 */
export type ResendSignatureVerificationInput = {
  payload: string
  svixId: string | null
  svixTimestamp: string | null
  svixSignature: string | null
  /** The `whsec_…` signing secret shown when the endpoint is created. */
  secret: string
  nowMs?: number
  toleranceSeconds?: number
}

/**
 * Svix secrets are `whsec_` + standard base64. The HMAC key is the decoded
 * bytes, not the printable string — signing with the string verifies nothing.
 */
function signingKey(secret: string): Buffer | null {
  const trimmed = secret.trim()
  if (!trimmed) return null
  const encoded = trimmed.startsWith('whsec_') ? trimmed.slice('whsec_'.length) : trimmed
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null
  const key = Buffer.from(encoded, 'base64')
  return key.length > 0 ? key : null
}

/**
 * The header carries a space-separated list so a secret can be rotated without
 * dropping deliveries: during rotation both the old and new signature appear,
 * and matching any one of them is enough.
 */
function candidateSignatures(header: string): Buffer[] {
  const out: Buffer[] = []
  for (const entry of header.split(' ')) {
    const separator = entry.indexOf(',')
    if (separator <= 0) continue
    if (entry.slice(0, separator) !== 'v1') continue
    const encoded = entry.slice(separator + 1)
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) continue
    out.push(Buffer.from(encoded, 'base64'))
  }
  return out
}

/**
 * Verify a Resend (Svix) webhook signature over the exact raw request body.
 *
 * Returns false rather than throwing on every malformed input: the caller's
 * only correct response to any of these cases is the same 401.
 */
export function verifyResendWebhookSignature(
  input: ResendSignatureVerificationInput,
): boolean {
  const { payload, svixId, svixTimestamp, svixSignature } = input
  if (!svixId || !svixTimestamp || !svixSignature) return false

  const key = signingKey(input.secret)
  if (!key) return false

  if (!/^\d+$/.test(svixTimestamp)) return false
  const timestamp = Number(svixTimestamp)
  if (!Number.isSafeInteger(timestamp)) return false

  const nowMs = input.nowMs ?? Date.now()
  const toleranceSeconds = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS
  if (!Number.isFinite(nowMs) || !Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) {
    return false
  }
  // Bound the replay window in both directions; a far-future timestamp is as
  // suspect as a stale one.
  if (Math.abs(Math.floor(nowMs / 1000) - timestamp) > toleranceSeconds) return false

  const expected = createHmac('sha256', key)
    .update(`${svixId}.${timestamp}.${payload}`)
    .digest()

  return candidateSignatures(svixSignature).some(
    candidate =>
      candidate.length === expected.length && timingSafeEqual(candidate, expected),
  )
}

/**
 * The delivery outcomes worth recording against a sent email. Opens and clicks
 * are deliberately absent: both tracking options are off on the sending domain,
 * and neither changes whether the mail arrived.
 */
export const RESEND_STATUS_EVENTS = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
} as const

export type ResendStatusEvent = keyof typeof RESEND_STATUS_EVENTS
export type ResendEmailStatus = (typeof RESEND_STATUS_EVENTS)[ResendStatusEvent]

/**
 * Webhook order is not guaranteed, so status is applied by precedence rather
 * than by arrival: a late `delivered` must never erase a `bounced`, and a
 * complaint outranks everything because it is the one that costs us the domain.
 *
 * `redirected` sits above the plain send states so a test-mode row keeps saying
 * so, and `error` stays where sendEmail put it.
 */
const STATUS_RANK: Record<string, number> = {
  logged: 0,
  sent: 1,
  delayed: 2,
  delivered: 3,
  redirected: 4,
  error: 5,
  failed: 6,
  bounced: 7,
  complained: 8,
}

export function isResendStatusEvent(type: string): type is ResendStatusEvent {
  return type in RESEND_STATUS_EVENTS
}

/**
 * Whether `next` should overwrite `current`. Unknown incoming statuses are
 * never written; an unknown stored status is treated as lowest so a real
 * outcome can still land on it.
 */
export function shouldApplyStatus(current: string | null, next: string): boolean {
  const incoming = STATUS_RANK[next]
  if (incoming === undefined) return false
  if (!current) return true
  return incoming > (STATUS_RANK[current] ?? -1)
}
