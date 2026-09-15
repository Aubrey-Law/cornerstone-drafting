import { verifyFirmaWebhookSignature } from '@/lib/esign/verify'
import type { EsignProviderName } from '@/lib/esign/types'

/**
 * The provider-specific half of webhook handling, and nothing more.
 *
 * An adapter answers two questions — "did this really come from the provider?"
 * and "which request is it about?" — and then gets out of the way. Everything
 * downstream (claiming the event, re-fetching authoritative state, storing
 * evidence, promoting the matter) is provider-neutral and lives in the shared
 * processor.
 *
 * The hint carries only identifiers on purpose. A webhook body is attacker-
 * influenced in the general case, so it is never allowed to *be* the state; it
 * only tells us which request to go and ask the provider about.
 */

export interface EsignWebhookHint {
  provider: EsignProviderName
  /** Provider's event id — the idempotency key, with the provider name. */
  externalEventId: string | null
  /** Provider's signing-request/envelope id. */
  externalRequestId: string | null
  eventType: string
}

export interface EsignWebhookAdapter {
  readonly provider: EsignProviderName
  verify(rawBody: string, headers: Headers): boolean
  parse(rawBody: string, headers: Headers): EsignWebhookHint
}

/** Event types that are a provider health check and own no signing request. */
export const WEBHOOK_TEST_EVENT_TYPES = new Set(['webhook.test'])

class FirmaWebhookAdapter implements EsignWebhookAdapter {
  readonly provider = 'firma' as const

  constructor(
    private readonly secret: string,
    private readonly previousSecret: string | undefined,
  ) {}

  verify(rawBody: string, headers: Headers): boolean {
    return verifyFirmaWebhookSignature({
      payload: rawBody,
      signatureHeader: headers.get('x-firma-signature'),
      oldSignatureHeader: headers.get('x-firma-signature-old'),
      secret: this.secret,
      previousSecret: this.previousSecret,
    })
  }

  parse(rawBody: string, headers: Headers): EsignWebhookHint {
    const payload = JSON.parse(rawBody) as Record<string, unknown>
    // Firma's standard payload nests the request under data.signing_request.
    // The older flat locations are retained for compatibility with events
    // already in flight.
    const data = (payload.data ?? payload) as Record<string, unknown>
    const signingRequest = (
      data.signing_request
      && typeof data.signing_request === 'object'
      && !Array.isArray(data.signing_request)
    )
      ? data.signing_request as Record<string, unknown>
      : null

    const eventType = [
      headers.get('x-firma-event'),
      payload.event_type,
      payload.type,
      data.event_type,
      data.type,
    ].find((value): value is string => typeof value === 'string' && value.length > 0)
      ?? 'signing_request.updated'

    const externalRequestId = [
      signingRequest?.id,
      data.signing_request_id,
      data.id,
      payload.signing_request_id,
    ].find((v): v is string => typeof v === 'string' && v.length > 0) ?? null

    return {
      provider: 'firma',
      externalEventId: typeof payload.id === 'string' && payload.id.length > 0 ? payload.id : null,
      externalRequestId,
      eventType,
    }
  }
}

export function createFirmaWebhookAdapter(input: {
  secret: string
  previousSecret?: string
}): EsignWebhookAdapter {
  return new FirmaWebhookAdapter(input.secret, input.previousSecret)
}

/**
 * Pick the adapter for an inbound delivery.
 *
 * Firma is the only provider that posts webhooks: the native provider signs
 * in-process and calls the completion module directly, so it has no inbound
 * delivery to authenticate. When a third provider appears, dispatch on a
 * path segment or header here rather than widening the Firma adapter.
 */
export function resolveWebhookAdapter():
  | { ok: true; adapter: EsignWebhookAdapter }
  | { ok: false; error: string } {
  const secret = process.env.FIRMA_WEBHOOK_SECRET?.trim()
  if (!secret) {
    return { ok: false, error: 'FIRMA_WEBHOOK_SECRET is not configured' }
  }
  return {
    ok: true,
    adapter: createFirmaWebhookAdapter({
      secret,
      previousSecret: process.env.FIRMA_WEBHOOK_SECRET_OLD?.trim(),
    }),
  }
}
