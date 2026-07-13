import { createHmac, timingSafeEqual } from 'crypto'

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

/**
 * Verify Cal.com webhook authenticity.
 * Header: `X-Cal-Signature-256` = HMAC-SHA256(secret, rawBody)
 */
export function verifyCalcomSignature(
  rawBody: string,
  secret: string,
  signatureHeader: string | null,
): boolean {
  if (!secret || !signatureHeader) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  return safeEqualHex(signatureHeader, expected)
}
