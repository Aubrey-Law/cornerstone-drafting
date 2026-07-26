import { createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_TOLERANCE_SECONDS = 5 * 60
const SHA256_HEX_LENGTH = 64

export type FirmaSignatureVerificationInput = {
  payload: string
  signatureHeader: string | null
  oldSignatureHeader?: string | null
  secret: string
  previousSecret?: string
  nowMs?: number
  toleranceSeconds?: number
}

type ParsedFirmaSignature = {
  timestamp: number
  signature: Buffer
}

function parseFirmaSignature(header: string | null | undefined): ParsedFirmaSignature | null {
  if (!header) return null

  const parts = header.split(',')
  if (parts.length !== 2) return null

  const values = new Map<string, string>()
  for (const part of parts) {
    const separator = part.indexOf('=')
    if (separator <= 0) return null
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (!value || values.has(key) || (key !== 't' && key !== 'v1')) return null
    values.set(key, value)
  }

  const timestampText = values.get('t')
  const signatureText = values.get('v1')
  if (!timestampText || !/^\d+$/.test(timestampText)) return null
  if (!signatureText || !new RegExp(`^[a-fA-F0-9]{${SHA256_HEX_LENGTH}}$`).test(signatureText)) {
    return null
  }

  const timestamp = Number(timestampText)
  if (!Number.isSafeInteger(timestamp)) return null
  return { timestamp, signature: Buffer.from(signatureText, 'hex') }
}

function verifyCandidate(
  payload: string,
  header: string | null | undefined,
  secret: string | undefined,
  nowMs: number,
  toleranceSeconds: number,
): boolean {
  if (!secret || !Number.isFinite(nowMs) || !Number.isFinite(toleranceSeconds) || toleranceSeconds < 0) {
    return false
  }

  const parsed = parseFirmaSignature(header)
  if (!parsed) return false

  const nowSeconds = Math.floor(nowMs / 1000)
  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) return false

  const expected = createHmac('sha256', secret)
    .update(`${parsed.timestamp}.${payload}`)
    .digest()
  return expected.length === parsed.signature.length && timingSafeEqual(expected, parsed.signature)
}

/**
 * Verify Firma's timestamped HMAC over the exact raw request body. During
 * secret rotation Firma sends the prior signature in X-Firma-Signature-Old;
 * that header is accepted only when a separate previous secret is configured.
 */
export function verifyFirmaWebhookSignature(input: FirmaSignatureVerificationInput): boolean {
  const nowMs = input.nowMs ?? Date.now()
  const toleranceSeconds = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS

  return verifyCandidate(
    input.payload,
    input.signatureHeader,
    input.secret,
    nowMs,
    toleranceSeconds,
  ) || verifyCandidate(
    input.payload,
    input.oldSignatureHeader,
    input.previousSecret,
    nowMs,
    toleranceSeconds,
  )
}
