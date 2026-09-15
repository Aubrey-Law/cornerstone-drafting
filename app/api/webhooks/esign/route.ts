import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { resolveEsignProvider } from '@/lib/esign/firma'
import { resolveWebhookAdapter, WEBHOOK_TEST_EVENT_TYPES } from '@/lib/esign/webhookAdapter'
import {
  applyRecipientStates,
  completeWorkspaceAgreement,
  ensureMatterHired,
  storeSignedEngagement,
  type CompletionFailure,
} from '@/lib/esign/completion'
import { createMatterFromIntake } from '@/lib/matters/createFromIntake'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/esign — e-signature provider events for engagement
 * agreements. Register https://{app}/api/webhooks/esign with the provider.
 *
 * The request is authenticated and parsed by a provider adapter
 * (lib/esign/webhookAdapter.ts); everything after that is provider-neutral.
 * The payload is treated as a hint only: the handler resolves the request id,
 * then fetches authoritative state from the provider API before writing
 * anything — a spoofed webhook can at most trigger a state re-check.
 *
 * What happens on completion lives in lib/esign/completion.ts, shared with the
 * in-process native signing route so the two cannot drift.
 *
 * Envelopes are sent from two places: the Leads page (matter-owned opportunity)
 * and the hired matter page. Signing promotes a lead opportunity in place.
 */

async function markWebhookProcessed(
  admin: SupabaseClient,
  provider: string,
  eventId: string,
  agreementId?: string | null,
) {
  const { error } = await admin
    .from('esign_webhook_events')
    .update({
      processed_at: new Date().toISOString(),
      error: null,
      ...(agreementId ? { agreement_id: agreementId } : {}),
    })
    .eq('provider', provider)
    .eq('event_id', eventId)
  if (error) throw new Error(error.message)
}

async function markWebhookFailed(
  admin: SupabaseClient,
  provider: string,
  eventId: string,
  message: string,
) {
  const { error } = await admin
    .from('esign_webhook_events')
    .update({ error: message })
    .eq('provider', provider)
    .eq('event_id', eventId)
  if (error) console.error('[esign webhook] failed to record processing error', error)
}

/**
 * Render a completion failure as an HTTP response.
 *
 * A retryable failure (evidence not generated yet) must be non-2xx: the
 * provider treats every 2xx as final and would never deliver again.
 */
function completionResponse(failure: CompletionFailure): NextResponse {
  return NextResponse.json(
    { error: failure.error },
    { status: failure.retryable ? 502 : 409 },
  )
}

export async function POST(req: Request) {
  const resolvedAdapter = resolveWebhookAdapter()
  if (!resolvedAdapter.ok) {
    console.error('[esign webhook]', resolvedAdapter.error)
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }
  const adapter = resolvedAdapter.adapter

  const rawBody = await req.text()
  if (!adapter.verify(rawBody, req.headers)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let hint: ReturnType<typeof adapter.parse>
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
    hint = adapter.parse(rawBody, req.headers)
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  if (WEBHOOK_TEST_EVENT_TYPES.has(hint.eventType)) {
    return NextResponse.json({ ok: true, test: true })
  }
  const envelopeId = hint.externalRequestId
  if (!envelopeId) {
    return NextResponse.json({ error: 'missing signing request id' }, { status: 400 })
  }
  const eventId = hint.externalEventId
  if (!eventId) {
    return NextResponse.json({ error: 'missing provider event id' }, { status: 400 })
  }

  const admin = getAdminClient()
  // Agreements created before the provider-neutral migration carry only
  // firma_request_id, so both columns are checked during the compatibility
  // window. Two equality filters rather than one interpolated `.or()`: the id
  // comes from the request body, and building filter syntax out of request
  // data is the wrong habit even when the body is HMAC-verified.
  const agreementColumns = 'id, matter_id, status, provider'
  const byExternal = await admin
    .from('engagement_agreements')
    .select(agreementColumns)
    .eq('external_request_id', envelopeId)
    .maybeSingle()
  if (byExternal.error) {
    console.error('[esign webhook] agreement lookup failed', byExternal.error)
    return NextResponse.json({ error: 'engagement lookup failed' }, { status: 500 })
  }
  const byLegacy = byExternal.data
    ? { data: null, error: null }
    : await admin
        .from('engagement_agreements')
        .select(agreementColumns)
        .eq('firma_request_id', envelopeId)
        .maybeSingle()
  if (byLegacy.error) {
    console.error('[esign webhook] legacy agreement lookup failed', byLegacy.error)
    return NextResponse.json({ error: 'engagement lookup failed' }, { status: 500 })
  }
  const agreement = byExternal.data ?? byLegacy.data

  const { data: details, error: detailsError } = agreement
    ? { data: null, error: null }
    : await admin
        .from('matter_details')
        .select('client_id, engagement_status, engagement_signed')
        .eq('engagement_envelope_id', envelopeId)
        .maybeSingle()
  if (detailsError) {
    console.error('[esign webhook] matter engagement lookup failed', detailsError)
    return NextResponse.json({ error: 'matter engagement lookup failed' }, { status: 500 })
  }
  const { data: lead, error: leadError } = agreement || details
    ? { data: null, error: null }
    : await admin
        .from('client_intake')
        .select('id, matter_id, engagement_status')
        .eq('engagement_envelope_id', envelopeId)
        .maybeSingle()
  if (leadError) {
    console.error('[esign webhook] lead engagement lookup failed', leadError)
    return NextResponse.json({ error: 'lead engagement lookup failed' }, { status: 500 })
  }
  // Unknown (stale/cancelled/foreign) envelope: ack so the provider stops retrying.
  if (!agreement && !details && !lead) return NextResponse.json({ ok: true, ignored: 'unknown envelope' })

  const { data: opportunity, error: opportunityError } = details
    ? await admin
        .from('matters')
        .select('id, client_intake_id, relationship_status')
        .eq('id', details.client_id as string)
        .maybeSingle()
    : { data: null, error: null }
  if (opportunityError) {
    console.error('[esign webhook] engagement opportunity lookup failed', opportunityError)
    return NextResponse.json({ error: 'engagement opportunity lookup failed' }, { status: 500 })
  }

  const resolved = resolveEsignProvider()
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 503 })
  }

  const { data: claimStatus, error: claimError } = await admin
    .rpc('claim_esign_webhook_event', {
      p_provider: adapter.provider,
      p_event_id: eventId,
      p_external_request_id: envelopeId,
      p_event_type: hint.eventType,
      p_payload: payload,
      p_agreement_id: agreement?.id ?? null,
    })
  if (claimError) {
    console.error('[esign webhook] event claim failed', claimError)
    return NextResponse.json({ error: 'webhook event claim failed' }, { status: 500 })
  }
  if (claimStatus === 'duplicate') {
    return NextResponse.json({ ok: true, duplicate: true })
  }
  // Providers treat every 2xx as final success. A non-2xx keeps the retry
  // schedule alive while the first delivery is still being processed.
  if (claimStatus === 'in_progress') {
    return NextResponse.json({ error: 'webhook event is still processing' }, { status: 503 })
  }
  if (claimStatus !== 'claimed') {
    return NextResponse.json({ error: 'unexpected webhook claim status' }, { status: 500 })
  }

  try {
    const fail = async (message: string, status: number) => {
      await markWebhookFailed(admin, adapter.provider, eventId, message)
      return NextResponse.json({ error: message }, { status })
    }
    const deferred = async (failure: CompletionFailure) => {
      await markWebhookFailed(admin, adapter.provider, eventId, failure.error)
      return completionResponse(failure)
    }
    const finish = async (agreementId?: string | null) => {
      await markWebhookProcessed(admin, adapter.provider, eventId, agreementId)
    }

    const state = await resolved.provider.getEnvelopeState(envelopeId)
    const now = new Date().toISOString()

    // Record that we reached the provider, whatever the outcome. The workspace
    // shows this so staff can tell "nothing has happened" from "we have not
    // been able to ask".
    if (agreement) {
      await admin
        .from('engagement_agreements')
        .update({ last_provider_sync_at: now, provider_sync_error: null, provider_sync_error_at: null })
        .eq('id', agreement.id)
    }

    if (agreement) {
      if (!agreement.matter_id) {
        return fail('engagement agreement has no matter owner', 409)
      }

      const status = state.status === 'signed' ? 'completed' : state.status
      await applyRecipientStates(admin, agreement.id as string, state.recipients ?? [])

      if (status === 'declined') {
        const { error: updateError } = await admin
          .from('engagement_agreements')
          .update({ status: 'cancelled', updated_at: now })
          .eq('id', agreement.id)
          .neq('status', 'completed')
        if (updateError) throw new Error(updateError.message)
      } else if (status === 'completed') {
        if (agreement.status !== 'completed') {
          const completed = await completeWorkspaceAgreement(admin, {
            agreementId: agreement.id as string,
            matterId: agreement.matter_id as string,
            state,
            provider: adapter.provider,
            externalRequestId: envelopeId,
          })
          if (!completed.ok) return deferred(completed)
        }
      } else if (['sent', 'viewed', 'partially_signed'].includes(status)) {
        const { error: updateError } = await admin
          .from('engagement_agreements')
          .update({ status, updated_at: now })
          .eq('id', agreement.id)
          .neq('status', 'completed')
        if (updateError) throw new Error(updateError.message)
      }

      await finish(agreement.id as string)
      return NextResponse.json({ ok: true, agreementId: agreement.id })
    }

    if (state.status === 'declined') {
      if (details && !details.engagement_signed && details.engagement_status !== 'signed') {
        const { error: updateError } = await admin
          .from('matter_details')
          .update({ engagement_status: 'declined' })
          .eq('client_id', details.client_id as string)
        if (updateError) throw new Error(updateError.message)
      }
      if (lead && lead.engagement_status !== 'signed') {
        const { error: updateError } = await admin
          .from('client_intake')
          .update({ engagement_status: 'declined' })
          .eq('id', lead.id as string)
        if (updateError) throw new Error(updateError.message)
      }
      await finish()
      return NextResponse.json({ ok: true })
    }

    if (state.status !== 'signed') {
      await finish()
      return NextResponse.json({ ok: true, ignored: state.status })
    }

    // Matter-attached envelope (matter-page sends, or a lead already converted).
    if (details) {
      // Duplicate deliveries after full success are pure no-ops.
      if (details.engagement_status === 'signed') {
        await finish()
        return NextResponse.json({ ok: true, duplicate: true })
      }
      if (!opportunity) {
        return fail('engagement opportunity not found', 409)
      }
      const hired = await ensureMatterHired(admin, opportunity.id as string)
      if (!hired.ok) return fail(hired.error, 409)

      const stored = await storeSignedEngagement(admin, {
        matterId: details.client_id as string,
        state,
        provider: adapter.provider,
        externalRequestId: envelopeId,
      })
      if (!stored.ok) return deferred(stored)
      await finish()
      return NextResponse.json({ ok: true })
    }

    // Lead envelope: signing converts the lead into a matter. Conversion is
    // idempotent (an existing matter for this intake is returned), and it
    // copies engagement_envelope_id onto matter_details — so a webhook retry
    // takes the matter branch above, whose duplicate guard applies.
    const leadId = lead!.id as string
    const converted = await createMatterFromIntake(admin, leadId)
    if (!converted.ok) {
      return fail(converted.error, 500)
    }

    const stored = await storeSignedEngagement(admin, {
      matterId: converted.matterId,
      state,
      provider: adapter.provider,
      externalRequestId: envelopeId,
    })
    if (!stored.ok) return deferred(stored)

    // Record the signed state on the lead row too (conversion history).
    const { error: leadUpdateError } = await admin
      .from('client_intake')
      .update({
        engagement_status: 'signed',
        engagement_signed_at: state.signedAt ?? new Date().toISOString(),
      })
      .eq('id', leadId)
    if (leadUpdateError) throw new Error(leadUpdateError.message)

    await finish()
    return NextResponse.json({ ok: true, matterId: converted.matterId })
  } catch (e) {
    console.error('[esign webhook]', e)
    const message = e instanceof Error ? e.message : 'webhook processing failed'
    await markWebhookFailed(admin, adapter.provider, eventId, message)
    if (agreement) {
      await admin
        .from('engagement_agreements')
        .update({ provider_sync_error: message, provider_sync_error_at: new Date().toISOString() })
        .eq('id', agreement.id)
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
