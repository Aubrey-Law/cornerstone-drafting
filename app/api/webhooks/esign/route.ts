import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { putFileToR2, safeUploadFilename } from '@/lib/documentUpload'
import { resolveEsignProvider } from '@/lib/esign/firma'
import { verifyEsignWebhookSecret } from '@/lib/esign/verify'

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
 */
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
  // Unknown (stale/cancelled/foreign) envelope: ack so the provider stops retrying.
  if (!details) return NextResponse.json({ ok: true, ignored: 'unknown envelope' })
  const matterId = details.client_id as string

  const resolved = resolveEsignProvider()
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 503 })
  }

  try {
    const state = await resolved.provider.getEnvelopeState(envelopeId)

    if (state.status === 'declined') {
      if (!details.engagement_signed && details.engagement_status !== 'signed') {
        await admin
          .from('matter_details')
          .update({ engagement_status: 'declined' })
          .eq('client_id', matterId)
      }
      return NextResponse.json({ ok: true })
    }

    if (state.status !== 'signed') {
      return NextResponse.json({ ok: true, ignored: state.status })
    }

    // Duplicate deliveries after full success are pure no-ops.
    if (details.engagement_status === 'signed') {
      return NextResponse.json({ ok: true, duplicate: true })
    }

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

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[esign webhook]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'webhook processing failed' },
      { status: 500 },
    )
  }
}
