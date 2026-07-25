import Telnyx from 'telnyx'

let client: Telnyx | null = null

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

export async function unwrapTelnyxWebhook<T>(req: Request, rawBody: string): Promise<T> {
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim()
  if (!publicKey) throw new Error('TELNYX_PUBLIC_KEY is not configured.')
  const signature = req.headers.get('telnyx-signature-ed25519') ?? ''
  const timestamp = req.headers.get('telnyx-timestamp') ?? ''
  return await getTelnyxClient().webhooks.unwrap(rawBody, {
    headers: {
      'telnyx-signature-ed25519': signature,
      'telnyx-timestamp': timestamp,
    },
    key: publicKey,
  }) as unknown as T
}
