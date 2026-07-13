import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { putFileToR2, safeUploadFilename } from '@/lib/documentUpload'
import { resolveEsignProvider } from '@/lib/esign/firma'
import { verifyEsignWebhookSecret } from '@/lib/esign/verify'
import { createMatterFromIntake } from '@/lib/matters/createFromIntake'
import type { EsignEnvelopeState } from '@/lib/esign/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/webhooks/esign — e-signature provider events for engagement
 * agreements. Register this URL with the provider as
 * https://{app}/api/webhooks/esign?secret={FIRMA_WEBHOOK_SECRET} (firma.dev
 * webhooks are not signed, so the secret travels on the URL).
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
): Promise<NextResponse | null> {
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
  const r2Key = `matters/${matterId}/signed/${Date.now()}-${filename}`
  await putFileToR2(r2Key, buffer, 'application/pdf')

  const { error: docError } = await admin.from('matter_documents').insert({
    matter_id: matterId,
    r2_key: r2Key,
    name: displayName,
    size: buffer.length,
    content_type: 'application/pdf',
    folder: 'signed',
    folder_id: null,
    uploaded_by: null,
  })
  if (docError) throw new Error(docError.message)

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

  return null
}

export async function POST(req: Request) {
  const secret = process.env.FIRMA_WEBHOOK_SECRET?.trim()
  if (!secret) {
    console.error('[esign webhook] FIRMA_WEBHOOK_SECRET is not configured')
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }
  const url = new URL(req.url)
  if (!verifyEsignWebhookSecret(url.searchParams.get('secret'), secret)) {
    return NextResponse.json({ error: 'invalid secret' }, { status: 401 })
  }

  const rawBody = await req.text()
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  // Envelope id location varies by event shape — check the common spots.
  const data = (payload.data ?? payload) as Record<string, unknown>
  const envelopeId =
    [data.signing_request_id, data.id, payload.signing_request_id]
      .find((v): v is string => typeof v === 'string' && v.length > 0) ?? null
  if (!envelopeId) {
    return NextResponse.json({ error: 'missing signing request id' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data: details } = await admin
    .from('matter_details')
    .select('client_id, engagement_status, engagement_signed')
    .eq('engagement_envelope_id', envelopeId)
    .maybeSingle()
  const { data: lead } = details
    ? { data: null }
    : await admin
        .from('client_intake')
        .select('id, matter_id, engagement_status')
        .eq('engagement_envelope_id', envelopeId)
        .maybeSingle()
  // Unknown (stale/cancelled/foreign) envelope: ack so the provider stops retrying.
  if (!details && !lead) return NextResponse.json({ ok: true, ignored: 'unknown envelope' })

  const { data: opportunity } = details
    ? await admin
        .from('matters')
        .select('id, client_intake_id, relationship_status')
        .eq('id', details.client_id as string)
        .maybeSingle()
    : { data: null }

  const resolved = resolveEsignProvider()
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 503 })
  }

  try {
    const state = await resolved.provider.getEnvelopeState(envelopeId)

    if (state.status === 'declined') {
      if (details && !details.engagement_signed && details.engagement_status !== 'signed') {
        await admin
          .from('matter_details')
          .update({ engagement_status: 'declined' })
          .eq('client_id', details.client_id as string)
      }
      if (lead && lead.engagement_status !== 'signed') {
        await admin
          .from('client_intake')
          .update({ engagement_status: 'declined' })
          .eq('id', lead.id as string)
      }
      return NextResponse.json({ ok: true })
    }

    if (state.status !== 'signed') {
      return NextResponse.json({ ok: true, ignored: state.status })
    }

    // Matter-attached envelope (matter-page sends, or a lead already converted).
    if (details) {
      // Duplicate deliveries after full success are pure no-ops.
      if (details.engagement_status === 'signed') {
        return NextResponse.json({ ok: true, duplicate: true })
      }
      if (!opportunity) {
        return NextResponse.json({ error: 'engagement opportunity not found' }, { status: 409 })
      }
      if (opportunity?.relationship_status !== 'hired') {
        if (opportunity?.relationship_status === 'lost') {
          return NextResponse.json({ error: 'lost opportunity must be reactivated before hiring' }, { status: 409 })
        }
        const promoted = await createMatterFromIntake(admin, opportunity.client_intake_id as string)
        if (!promoted.ok) return NextResponse.json({ error: promoted.error }, { status: 500 })
      }
      const failure = await storeSignedEngagement(admin, details.client_id as string, state)
      if (failure) return failure
      return NextResponse.json({ ok: true })
    }

    // Lead envelope: signing converts the lead into a matter. Conversion is
    // idempotent (an existing matter for this intake is returned), and it
    // copies engagement_envelope_id onto matter_details — so a webhook retry
    // takes the matter branch above, whose duplicate guard applies.
    const leadId = lead!.id as string
    const converted = await createMatterFromIntake(admin, leadId)
    if (!converted.ok) {
      return NextResponse.json({ error: converted.error }, { status: 500 })
    }

    const failure = await storeSignedEngagement(admin, converted.matterId, state)
    if (failure) return failure

    // Record the signed state on the lead row too (conversion history).
    await admin
      .from('client_intake')
      .update({
        engagement_status: 'signed',
        engagement_signed_at: state.signedAt ?? new Date().toISOString(),
      })
      .eq('id', leadId)

    return NextResponse.json({ ok: true, matterId: converted.matterId })
  } catch (e) {
    console.error('[esign webhook]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'webhook processing failed' },
      { status: 500 },
    )
  }
}
