import twilio from 'twilio'

/** Reconstruct the public URL Twilio signed (needed behind Vercel proxies). */
export function twilioWebhookUrl(req: Request): string {
  const base = process.env.TWILIO_WEBHOOK_BASE_URL?.replace(/\/$/, '')
  if (base) {
    const { pathname, search } = new URL(req.url)
    return `${base}${pathname}${search}`
  }
  return req.url
}

/** Validate Twilio webhook signature (status callbacks, etc.). */
export function verifyTwilioRequest(req: Request, params: Record<string, string>): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  if (!authToken) {
    console.error('[twilio] missing TWILIO_AUTH_TOKEN for webhook verification')
    return false
  }

  const signature = req.headers.get('x-twilio-signature')
  if (!signature) return false

  return twilio.validateRequest(authToken, signature, twilioWebhookUrl(req), params)
}
