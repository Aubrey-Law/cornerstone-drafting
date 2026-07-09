import { createHmac, timingSafeEqual } from 'crypto'

const MAX_SKEW_MS = 5 * 60 * 1000

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

/**
 * Verify Retell webhook authenticity.
 * Header: `x-retell-signature: v={unix_ms},d={hmac_sha256_hex}`
 * Digest = HMAC-SHA256(apiKey, rawBody + timestamp)
 */
export function verifyRetellSignature(
  rawBody: string,
  apiKey: string,
  signatureHeader: string | null,
  nowMs: number = Date.now(),
): boolean {
  if (!apiKey || !signatureHeader) return false

  const match = /^v=(\d+),d=([0-9a-fA-F]+)$/.exec(signatureHeader.trim())
  if (!match) return false

  const timestamp = match[1]
  const digest = match[2]
  const tsNum = Number.parseInt(timestamp, 10)
  if (!Number.isFinite(tsNum)) return false
  if (Math.abs(nowMs - tsNum) > MAX_SKEW_MS) return false

  const expected = createHmac('sha256', apiKey)
    .update(rawBody + timestamp, 'utf8')
    .digest('hex')

  return safeEqualHex(expected.toLowerCase(), digest.toLowerCase())
}
