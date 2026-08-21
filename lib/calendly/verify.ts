import { createHmac, timingSafeEqual } from 'crypto'

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

/** Compare the high-entropy secret embedded in the subscribed callback URL. */
export function verifyCalendlyWebhookSecret(
  expectedSecret: string,
  suppliedSecret: string | null,
): boolean {
  if (!expectedSecret || !suppliedSecret) return false
  const expected = Buffer.from(expectedSecret, 'utf8')
  const supplied = Buffer.from(suppliedSecret, 'utf8')
  if (expected.length !== supplied.length) return false
  return timingSafeEqual(expected, supplied)
}

/**
 * Verify Calendly webhook authenticity.
 * Header: `Calendly-Webhook-Signature` = `t=<unix seconds>,v1=<hex>` where
 * v1 = HMAC-SHA256(signingKey, `${t}.${rawBody}`). The timestamp is part of
 * the signed message, so a bounded tolerance also rejects replays.
 */
export function verifyCalendlySignature(
  rawBody: string,
  signingKey: string,
  signatureHeader: string | null,
  options?: { toleranceSeconds?: number; nowMs?: number },
): boolean {
  if (!signingKey || !signatureHeader) return false

  let timestamp: string | null = null
  let signature: string | null = null
  for (const part of signatureHeader.split(',')) {
    const [key, value] = part.split('=', 2).map(item => item?.trim())
    if (key === 't' && value) timestamp = value
    if (key === 'v1' && value) signature = value
  }
  if (!timestamp || !signature) return false

  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds)) return false

  const toleranceSeconds = options?.toleranceSeconds ?? 300
  const nowSeconds = (options?.nowMs ?? Date.now()) / 1000
  if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) return false

  const expected = createHmac('sha256', signingKey)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')
  return safeEqualHex(signature, expected)
}
