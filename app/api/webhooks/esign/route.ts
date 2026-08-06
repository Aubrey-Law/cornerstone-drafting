import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { putFileToR2, safeUploadFilename } from '@/lib/documentUpload'
import { resolveEsignProvider } from '@/lib/esign/firma'
import { verifyFirmaWebhookSignature } from '@/lib/esign/verify'
import { createMatterFromIntake } from '@/lib/matters/createFromIntake'
import type { EsignEnvelopeState } from '@/lib/esign/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/esign — e-signature provider events for engagement
 * agreements. Register https://{app}/api/webhooks/esign with Firma. The
 * handler verifies Firma's timestamped HMAC over the exact raw request body.
 *
 * The payload is treated as a hint only: the handler resolves the envelope
 * id, then fetches authoritative state from the provider API before writing
 * anything — a spoofed webhook can at most trigger a state re-check.
 *
 * Envelopes are sent from two places: the Leads page (matter-owned opportunity)
 * and the hired matter page. Signing promotes a lead opportunity in place.
 */

/** Download the combined signed PDF + audit certificate into the matter's Signed documents. */
async function storeSignedEngagement(
  admin: SupabaseClient,
  matterId: string,
  state: EsignEnvelopeState,
  agreementId?: string,
): Promise<{ r2Key: string } | NextResponse> {
  // The combined signed-document + audit-certificate PDF may lag signing
  // while the certificate generates; 502 makes the provider retry.
  if (!state.finalDocumentUrl) {
    return NextResponse.json({ error: 'signed document not ready yet' }, { status: 502 })
  }
  const download = await fetch(state.finalDocumentUrl)
  if (!download.ok) {
    return NextResponse.json({ error: 'signed document download failed' }, { status: 502 })
  }
  const buffer = Buffer.from(await download.arrayBuffer())

  const { data: matter } = await admin
    .from('v_matter_pipeline')
    .select('client_name')
    .eq('matter_id', matterId)
    .maybeSingle()
  const displayName = `Engagement Agreement - ${matter?.client_name ?? 'Client'} - signed.pdf`
  const filename = safeUploadFilename(displayName)
  const r2Key = agreementId
    ? `matters/${matterId}/signed/engagement-agreement-${agreementId}.pdf`
    : `matters/${matterId}/signed/${Date.now()}-${filename}`
  await putFileToR2(r2Key, buffer, 'application/pdf')

  const { data: existingDocument, error: documentReadError } = await admin
    .from('matter_documents')
    .select('id')
    .eq('matter_id', matterId)
    .eq('r2_key', r2Key)
    .maybeSingle()
  if (documentReadError) throw new Error(documentReadError.message)
  if (!existingDocument) {
    const { error: docError } = await admin.from('matter_documents').insert({
      ...(agreementId ? { id: agreementId } : {}),
      matter_id: matterId,
      r2_key: r2Key,
      name: displayName,
      size: buffer.length,
      content_type: 'application/pdf',
      folder: 'signed',
      folder_id: null,
      source: 'firm',
      shared_at: new Date().toISOString(),
      uploaded_by: null,
    })
    if (docError && !(agreementId && docError.code === '23505')) throw new Error(docError.message)
  }

  // Status flip last: a retry after a partial failure redoes the work above
  // (worst case one orphaned R2 object) and a retry after success no-ops.
  const { error: updateError } = await admin
    .from('matter_details')
    .update({
      engagement_signed: true,
      engagement_status: 'signed',
      engagement_signed_at: state.signedAt ?? new Date().toISOString(),
    })
    .eq('client_id', matterId)
  if (updateError) throw new Error(updateError.message)

  return { r2Key }
}

async function markFirmaWebhookProcessed(
  admin: SupabaseClient,
  eventId: string,
  agreementId?: string | null,
) {
  const { error } = await admin
    .from('firma_webhook_events')
    .update({
      processed_at: new Date().toISOString(),
      error: null,
      ...(agreementId ? { agreement_id: agreementId } : {}),
    })
    .eq('event_id', eventId)
  if (error) throw new Error(error.message)
}

async function markFirmaWebhookFailed(
  admin: SupabaseClient,
  eventId: string,
  message: string,
) {
  const { error } = await admin
    .from('firma_webhook_events')
    .update({ error: message })
    .eq('event_id', eventId)
  if (error) console.error('[esign webhook] failed to record processing error', error)
}

export async function POST(req: Request) {
  const secret = process.env.FIRMA_WEBHOOK_SECRET?.trim()
  if (!secret) {
    console.error('[esign webhook] FIRMA_WEBHOOK_SECRET is not configured')
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }
  const rawBody = await req.text()
  if (!verifyFirmaWebhookSignature({
    payload: rawBody,
    signatureHeader: req.headers.get('x-firma-signature'),
    oldSignatureHeader: req.headers.get('x-firma-signature-old'),
    secret,
    previousSecret: process.env.FIRMA_WEBHOOK_SECRET_OLD?.trim(),
  })) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  // Firma's standard payload nests the request under data.signing_request.
  // Retain the older flat locations for compatibility with existing events.
  const data = (payload.data ?? payload) as Record<string, unknown>
  const eventId = typeof payload.id === 'string' && payload.id.length > 0
    ? payload.id
    : null
  const eventType = [
    req.headers.get('x-firma-event'),
    payload.event_type,
    payload.type,
    data.event_type,
    data.type,
  ]
    .find((value): value is string => typeof value === 'string' && value.length > 0)
    ?? 'signing_request.updated'
  if (eventType === 'webhook.test') {
    return NextResponse.json({ ok: true, test: true })
  }
  const signingRequest = (
    data.signing_request
    && typeof data.signing_request === 'object'
    && !Array.isArray(data.signing_request)
  )
    ? data.signing_request as Record<string, unknown>
    : null
  const envelopeId =
    [signingRequest?.id, data.signing_request_id, data.id, payload.signing_request_id]
      .find((v): v is string => typeof v === 'string' && v.length > 0) ?? null
  if (!envelopeId) {
    return NextResponse.json({ error: 'missing signing request id' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data: agreement, error: agreementError } = await admin
    .from('engagement_agreements')
    .select('id, matter_id, status')
    .eq('firma_request_id', envelopeId)
    .maybeSingle()
  if (agreementError) {
    console.error('[esign webhook] agreement lookup failed', agreementError)
    return NextResponse.json({ error: 'engagement lookup failed' }, { status: 500 })
  }

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

  if (!eventId) {
    return NextResponse.json({ error: 'missing Firma event id' }, { status: 400 })
  }
  const { data: claimStatus, error: claimError } = await admin
    .rpc('claim_firma_webhook_event', {
      p_event_id: eventId,
      p_firma_request_id: envelopeId,
      p_event_type: eventType,
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
  // Firma treats every 2xx as final success. A non-2xx keeps its retry
  // schedule alive while the first delivery is still being processed.
  if (claimStatus === 'in_progress') {
    return NextResponse.json({ error: 'webhook event is still processing' }, { status: 503 })
  }
  if (claimStatus !== 'claimed') {
    return NextResponse.json({ error: 'unexpected Firma webhook claim status' }, { status: 500 })
  }

  let versionedEventId: string | null = null
  try {
    versionedEventId = eventId
    const fail = async (message: string, status: number) => {
      await markFirmaWebhookFailed(admin, eventId, message)
      return NextResponse.json({ error: message }, { status })
    }
    const finish = async (agreementId?: string | null) => {
      await markFirmaWebhookProcessed(admin, eventId, agreementId)
    }

    if (agreement) {
      if (!agreement.matter_id) {
        return fail('engagement agreement has no matter owner', 409)
      }

      const state = await resolved.provider.getEnvelopeState(envelopeId)
      const status = state.status === 'signed' ? 'completed' : state.status
      const now = new Date().toISOString()

      for (const recipient of state.recipients ?? []) {
        const timestamps = recipient.status === 'signed'
          ? { signed_at: recipient.signedAt ?? now }
          : recipient.status === 'declined'
            ? { declined_at: recipient.declinedAt ?? now }
            : {}
        const { error: recipientStateError } = await admin
          .from('engagement_agreement_recipients')
          .update({ status: recipient.status, ...timestamps })
          .eq('agreement_id', agreement.id)
          .eq('email', recipient.email.toLowerCase())
        if (recipientStateError) throw new Error(recipientStateError.message)
      }

      if (status === 'declined') {
        const { error: updateError } = await admin
          .from('engagement_agreements')
          .update({ status: 'cancelled', updated_at: now })
          .eq('id', agreement.id)
          .neq('status', 'completed')
        if (updateError) throw new Error(updateError.message)
      } else if (status === 'completed') {
        if (agreement.status !== 'completed') {
          const { data: matter, error: matterError } = await admin
            .from('matters')
            .select('id, client_intake_id, relationship_status')
            .eq('id', agreement.matter_id as string)
            .single()
          if (matterError) throw new Error(matterError.message)
          if (matter.relationship_status === 'lost') {
            return fail('lost opportunity must be reactivated before hiring', 409)
          }
          if (matter.relationship_status !== 'hired') {
            const promoted = await createMatterFromIntake(admin, matter.client_intake_id as string)
            if (!promoted.ok) return fail(promoted.error, 500)
          }

          const stored = await storeSignedEngagement(admin, agreement.matter_id as string, state, agreement.id as string)
          if (stored instanceof NextResponse) {
            await markFirmaWebhookFailed(admin, eventId, 'signed document storage deferred')
            return stored
          }
          const { error: completionError } = await admin
            .from('engagement_agreements')
            .update({
              status: 'completed',
              completed_r2_key: stored.r2Key,
              completed_at: state.signedAt ?? now,
              updated_at: now,
            })
            .eq('id', agreement.id)
          if (completionError) throw new Error(completionError.message)
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

    const state = await resolved.provider.getEnvelopeState(envelopeId)
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
      if (opportunity?.relationship_status !== 'hired') {
        if (opportunity?.relationship_status === 'lost') {
          return fail('lost opportunity must be reactivated before hiring', 409)
        }
        const promoted = await createMatterFromIntake(admin, opportunity.client_intake_id as string)
        if (!promoted.ok) return fail(promoted.error, 500)
      }
      const stored = await storeSignedEngagement(admin, details.client_id as string, state)
      if (stored instanceof NextResponse) {
        await markFirmaWebhookFailed(admin, eventId, 'signed document storage deferred')
        return stored
      }
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

    const stored = await storeSignedEngagement(admin, converted.matterId, state)
    if (stored instanceof NextResponse) {
      await markFirmaWebhookFailed(admin, eventId, 'signed document storage deferred')
      return stored
    }

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
    if (versionedEventId) {
      await admin
        .from('firma_webhook_events')
        .update({ error: e instanceof Error ? e.message : 'webhook processing failed' })
        .eq('event_id', versionedEventId)
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'webhook processing failed' },
      { status: 500 },
    )
  }
}
