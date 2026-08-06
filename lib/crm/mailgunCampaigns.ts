import { createHash, randomUUID } from 'crypto'

type MailgunRecipient = {
  email: string
  deliveryToken: string
  unsubscribeUrl: string
}

type SendMailgunBatchInput = {
  subject: string
  html: string
  text: string
  tag: string
  recipients: MailgunRecipient[]
}

export function mailgunConfigured(): boolean {
  return Boolean(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN && process.env.MAILGUN_FROM_EMAIL)
}

export function createDeliveryToken(): string {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
}

export function unsubscribeTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function sendMailgunCampaignBatch(input: SendMailgunBatchInput): Promise<{ messageId: string }> {
  const apiKey = process.env.MAILGUN_API_KEY
  const domain = process.env.MAILGUN_DOMAIN
  const from = process.env.MAILGUN_FROM_EMAIL
  if (!apiKey || !domain || !from) throw new Error('Mailgun campaign delivery is not configured')
  if (!input.recipients.length || input.recipients.length > 1000) throw new Error('Mailgun batches require 1-1000 recipients')

  const form = new FormData()
  form.set('from', from)
  form.set('subject', input.subject)
  form.set('html', input.html)
  form.set('text', input.text)
  form.set('o:tracking', 'yes')
  form.set('o:tag', input.tag.slice(0, 128))
  for (const recipient of input.recipients) form.append('to', recipient.email)
  form.set('recipient-variables', JSON.stringify(Object.fromEntries(input.recipients.map(recipient => [recipient.email, {
    delivery_token: recipient.deliveryToken,
    unsubscribe_url: recipient.unsubscribeUrl,
  }]))))
  form.set('v:crm_delivery_token', '%recipient.delivery_token%')

  const base = (process.env.MAILGUN_API_BASE || 'https://api.mailgun.net').replace(/\/$/, '')
  const auth = Buffer.from(`api:${apiKey}`).toString('base64')
  const response = await fetch(`${base}/v3/${encodeURIComponent(domain)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
    body: form,
  })
  const payload = await response.json().catch(() => ({})) as { id?: string; message?: string }
  if (!response.ok || !payload.id) throw new Error(payload.message || `Mailgun send failed (${response.status})`)
  return { messageId: payload.id }
}
