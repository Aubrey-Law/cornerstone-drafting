import Telnyx from 'telnyx'
import { createPublicKey, verify } from 'node:crypto'

let client: Telnyx | null = null

const TELNYX_WEBHOOK_TOLERANCE_SECONDS = 300
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export function getTelnyxClient(): Telnyx {
  const apiKey = process.env.TELNYX_API_KEY?.trim()
  if (!apiKey) throw new Error('Telnyx is not configured.')
  if (!client) {
    client = new Telnyx({
      apiKey,
      publicKey: process.env.TELNYX_PUBLIC_KEY?.trim(),
    })
  }
  return client
}

export function verifyTelnyxWebhookSignature(
  rawBody: string,
  signature: string,
  timestamp: string,
  publicKey: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (!signature || !timestamp) throw new Error('Missing Telnyx webhook signature headers')
  const timestampSeconds = Number(timestamp)
  if (!Number.isInteger(timestampSeconds)) throw new Error('Invalid Telnyx webhook timestamp')
  if (Math.abs(nowSeconds - timestampSeconds) > TELNYX_WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error('Telnyx webhook timestamp is outside the allowed tolerance')
  }

  const rawPublicKey = Buffer.from(publicKey, 'base64')
  if (rawPublicKey.length !== 32) throw new Error('Invalid Telnyx public key')
  const signatureBytes = Buffer.from(signature, 'base64')
  if (signatureBytes.length !== 64) throw new Error('Invalid Telnyx webhook signature')
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]),
    format: 'der',
    type: 'spki',
  })
  const valid = verify(
    null,
    Buffer.from(`${timestamp}|${rawBody}`),
    key,
    signatureBytes,
  )
  if (!valid) throw new Error('Invalid Telnyx webhook signature')
}

export function verifyTelnyxWebhookRequest(req: Request, rawBody: string): void {
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim()
  if (!publicKey) throw new Error('TELNYX_PUBLIC_KEY is not configured.')
  const signature = req.headers.get('telnyx-signature-ed25519') ?? ''
  const timestamp = req.headers.get('telnyx-timestamp') ?? ''
  verifyTelnyxWebhookSignature(rawBody, signature, timestamp, publicKey)
}

export async function unwrapTelnyxWebhook<T>(req: Request, rawBody: string): Promise<T> {
  verifyTelnyxWebhookRequest(req, rawBody)
  return JSON.parse(rawBody) as T
}
