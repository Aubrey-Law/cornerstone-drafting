import 'server-only'

import { FirmaClient } from '@firma-dev/sdk'
import type { EsignDocumentRequestInput, EsignDocumentRequestResult, EsignEnvelopeState, EsignProvider, EsignSigner } from '@/lib/esign/types'

/**
 * firma.dev e-signature provider.
 *
 * Env:
 *  - FIRMA_API_KEY: API key (sent as the Authorization header by the SDK)
 *  - FIRMA_ENGAGEMENT_TEMPLATE_ID: single-signer engagement template (solo client)
 *  - FIRMA_ENGAGEMENT_TEMPLATE_ID_JOINT: two-signer template (client + spouse)
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

function toRecipient(signer: EsignSigner, order: number) {
  const { firstName, lastName } = splitName(signer.name)
  return {
    first_name: firstName,
    ...(lastName ? { last_name: lastName } : {}),
    email: signer.email,
    designation: 'Signer' as const,
    order,
  }
}

class FirmaEsignProvider implements EsignProvider {
  readonly name = 'firma'
  private readonly client: FirmaClient
  private readonly singleTemplateId: string
  private readonly jointTemplateId: string | null
  private readonly fetcher: typeof fetch
  private readonly apiKeyValue: string

  constructor(apiKey: string, singleTemplateId: string, jointTemplateId: string | null, fetcher: typeof fetch = fetch) {
    this.client = new FirmaClient({ apiKey })
    this.singleTemplateId = singleTemplateId
    this.jointTemplateId = jointTemplateId
    this.fetcher = fetcher
    this.apiKeyValue = apiKey
  }

  async createDocumentRequest(input: EsignDocumentRequestInput): Promise<EsignDocumentRequestResult> {
    const keys = new Set(input.recipients.map(recipient => recipient.key))
    if (keys.size !== input.recipients.length || input.anchors.some(anchor => !keys.has(anchor.recipientKey))) {
      throw new Error('Every e-sign anchor must reference one unique recipient key')
    }
    const recipients = [...input.recipients].sort((a, b) => a.order - b.order).map(recipient => {
      const { firstName, lastName } = splitName(recipient.name)
      return { id: recipient.key, first_name: firstName, ...(lastName ? { last_name: lastName } : {}), email: recipient.email, designation: 'Signer', order: recipient.order }
    })
    const response = await this.fetcher('https://api.firma.dev/functions/v1/signing-request-api/signing-requests', {
      method: 'POST', headers: { Authorization: this.apiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: input.name, document: input.document.toString('base64'), recipients,
        expiration_hours: input.expirationHours,
        anchor_tags: input.anchors.map(anchor => ({
          anchor_string: anchor.marker, type: anchor.type, recipient_id: anchor.recipientKey,
          required: anchor.required, ...(anchor.dateSigningDefault === undefined ? {} : { date_signing_default: anchor.dateSigningDefault }),
          remove_anchor_text: true,
        })),
      }),
    })
    const body = await response.json() as { id?: unknown; recipients?: Array<Record<string, unknown>>; message?: unknown }
    if (!response.ok) throw new Error(`firma.dev document request failed (${response.status})${typeof body.message === 'string' ? `: ${body.message}` : ''}`)
    if (typeof body.id !== 'string' || !body.id) throw new Error('firma.dev did not return a signing request id')
    const mapped = input.recipients.map((recipient, index) => {
      const external = body.recipients?.find(item => item.temporary_id === recipient.key || item.id === recipient.key) ?? body.recipients?.[index]
      if (typeof external?.id !== 'string' || !external.id) throw new Error(`firma.dev did not return recipient id for ${recipient.key}`)
      return { key: recipient.key, externalId: external.id, signingLink: typeof external.signing_link === 'string' ? external.signing_link : null }
    })
    return { requestId: body.id, recipients: mapped }
  }

  async sendDocumentRequest(requestId: string, customMessage: string): Promise<void> {
    const response = await this.fetcher(`https://api.firma.dev/functions/v1/signing-request-api/signing-requests/${encodeURIComponent(requestId)}/send`, {
      method: 'POST', headers: { Authorization: this.apiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_message: customMessage }),
    })
    if (!response.ok) throw new Error(`firma.dev send failed (${response.status})`)
  }

  private apiKey(): string {
    return this.apiKeyValue
  }

  async createEngagementEnvelope(
    input: { primary: EsignSigner; spouse?: EsignSigner },
  ): Promise<{ envelopeId: string; signingLink: string | null }> {
    // A spouse means two signer roles, which requires the joint template.
    const templateId = input.spouse ? this.jointTemplateId : this.singleTemplateId
    if (!templateId) {
      throw new Error(
        'A two-signer engagement template is not configured (set FIRMA_ENGAGEMENT_TEMPLATE_ID_JOINT).',
      )
    }
    const recipients = [toRecipient(input.primary, 1)]
    if (input.spouse) recipients.push(toRecipient(input.spouse, 2))

    // Template-based create+send: recipients update the template's signer
    // roles (matched by order); firma.dev emails each signer their link, and
    // the response carries the primary signer's direct link for "Sign now".
    const response = await this.client.signingRequests.createAndSendSigningRequest({
      template_id: templateId,
      // firma.dev's create-and-send requires a signing-request name.
      name: `Engagement Agreement — ${input.primary.name.trim() || input.primary.email}`,
      recipients,
    })
    const envelopeId = (response as { id?: unknown })?.id
    if (typeof envelopeId !== 'string' || !envelopeId) {
      throw new Error('firma.dev did not return a signing request id')
    }
    const signingLink = (response as { first_signer?: { signing_link?: unknown } })?.first_signer
      ?.signing_link
    return { envelopeId, signingLink: typeof signingLink === 'string' ? signingLink : null }
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

export function createFirmaEsignProvider(input: { apiKey: string; singleTemplateId: string; jointTemplateId: string | null; fetcher?: typeof fetch }): EsignProvider {
  return new FirmaEsignProvider(input.apiKey, input.singleTemplateId, input.jointTemplateId, input.fetcher)
}

/**
 * Mint a short-lived JWT that authorizes the browser-side firma.dev template
 * editor to edit the engagement-agreement template. The API key stays on the
 * server; only this token crosses to the client.
 *
 * firma.dev exposes this as a plain function endpoint (not part of the SDK's
 * typed surface), so we call it with fetch directly — this stays correct
 * regardless of the pinned @firma-dev/sdk version.
 */
export async function generateEngagementTemplateToken():
  | Promise<{ ok: true; token: string; templateId: string } | { ok: false; error: string }> {
  const apiKey = process.env.FIRMA_API_KEY?.trim()
  const templateId = process.env.FIRMA_ENGAGEMENT_TEMPLATE_ID?.trim()
  const missing = [
    !apiKey ? 'FIRMA_API_KEY' : null,
    !templateId ? 'FIRMA_ENGAGEMENT_TEMPLATE_ID' : null,
  ].filter(Boolean)
  if (missing.length > 0 || !apiKey || !templateId) {
    return { ok: false, error: `E-signature is not configured (missing ${missing.join(', ')}).` }
  }

  try {
    const response = await fetch(
      'https://api.firma.dev/functions/v1/signing-request-api/generate-template-token',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ companies_workspaces_templates_id: templateId }),
      },
    )
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return {
        ok: false,
        error: `firma.dev returned ${response.status} generating the template token${detail ? `: ${detail}` : ''}`,
      }
    }
    const data = (await response.json()) as { token?: unknown }
    if (typeof data.token !== 'string' || !data.token) {
      return { ok: false, error: 'firma.dev did not return a template token.' }
    }
    return { ok: true, token: data.token, templateId }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Could not reach firma.dev to generate a template token.',
    }
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
  const jointTemplateId = process.env.FIRMA_ENGAGEMENT_TEMPLATE_ID_JOINT?.trim() || null
  return { ok: true, provider: new FirmaEsignProvider(apiKey, templateId, jointTemplateId) }
}
