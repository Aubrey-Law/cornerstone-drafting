import 'server-only'

import { FirmaClient } from '@firma-dev/sdk'
import type { EsignEnvelopeState, EsignProvider } from '@/lib/esign/types'

/**
 * firma.dev e-signature provider.
 *
 * Env:
 *  - FIRMA_API_KEY: API key (sent as the Authorization header by the SDK)
 *  - FIRMA_ENGAGEMENT_TEMPLATE_ID: the engagement-agreement template id
 *  - FIRMA_WEBHOOK_SECRET: shared secret carried in the registered webhook
 *    URL's ?secret= query param — firma.dev webhooks are not signed, so the
 *    webhook handler also re-fetches envelope state from the API before
 *    acting (the webhook is a hint; the API is the truth).
 */

export function isEsignConfigured(): boolean {
  return Boolean(
    process.env.FIRMA_API_KEY?.trim() && process.env.FIRMA_ENGAGEMENT_TEMPLATE_ID?.trim(),
  )
}

function splitName(fullName: string): { firstName: string; lastName: string | undefined } {
  const parts = fullName.trim().split(/\s+/)
  const firstName = parts[0] || 'Client'
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : undefined
  return { firstName, lastName }
}

class FirmaEsignProvider implements EsignProvider {
  readonly name = 'firma'
  private readonly client: FirmaClient
  private readonly templateId: string

  constructor(apiKey: string, templateId: string) {
    this.client = new FirmaClient({ apiKey })
    this.templateId = templateId
  }

  async createEngagementEnvelope(input: { name: string; email: string }): Promise<{ envelopeId: string }> {
    const { firstName, lastName } = splitName(input.name)
    // Template-based create+send: the recipient updates the template's sole
    // signer (matched by order); firma.dev emails the signing link itself.
    const response = await this.client.signingRequests.createAndSendSigningRequest({
      template_id: this.templateId,
      recipients: [
        {
          first_name: firstName,
          ...(lastName ? { last_name: lastName } : {}),
          email: input.email,
          designation: 'Signer',
          order: 1,
        },
      ],
    })
    const envelopeId = (response as { id?: unknown })?.id
    if (typeof envelopeId !== 'string' || !envelopeId) {
      throw new Error('firma.dev did not return a signing request id')
    }
    return { envelopeId }
  }

  async cancelEnvelope(envelopeId: string): Promise<void> {
    try {
      await this.client.signingRequests.cancelSigningRequest({
        id: envelopeId,
        reason: 'Superseded by a re-sent engagement agreement',
        notify_signers: false,
      })
    } catch (e) {
      console.warn('[esign] cancel envelope failed (ignored)', e)
    }
  }

  async getEnvelopeState(envelopeId: string): Promise<EsignEnvelopeState> {
    const detail = await this.client.signingRequests.getSigningRequest({ id: envelopeId })
    const status = detail.status ?? {}
    if (status.finished) {
      return {
        status: 'signed',
        signedAt: detail.timestamps?.finished_on ?? null,
        finalDocumentUrl: detail.final_document_download_url ?? null,
      }
    }
    if (status.declined || status.expired || status.cancelled) {
      return { status: 'declined', signedAt: null, finalDocumentUrl: null }
    }
    if (status.sent) {
      return { status: 'sent', signedAt: null, finalDocumentUrl: null }
    }
    return { status: 'unknown', signedAt: null, finalDocumentUrl: null }
  }
}

export function resolveEsignProvider():
  | { ok: true; provider: EsignProvider }
  | { ok: false; error: string } {
  const apiKey = process.env.FIRMA_API_KEY?.trim()
  const templateId = process.env.FIRMA_ENGAGEMENT_TEMPLATE_ID?.trim()
  const missing = [
    !apiKey ? 'FIRMA_API_KEY' : null,
    !templateId ? 'FIRMA_ENGAGEMENT_TEMPLATE_ID' : null,
  ].filter(Boolean)
  if (missing.length > 0 || !apiKey || !templateId) {
    return { ok: false, error: `E-signature is not configured (missing ${missing.join(', ')}).` }
  }
  return { ok: true, provider: new FirmaEsignProvider(apiKey, templateId) }
}
