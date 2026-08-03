import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { resolveEsignProvider } from '@/lib/esign/firma'

/**
 * POST /api/admin/matters/[id]/engagement — send (or re-send) the engagement
 * agreement for signature. The provider emails the client its signing link;
 * completion is recorded by the /api/webhooks/esign handler.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, err } = await requireAdmin(req)
  if (err) return err
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const resolved = resolveEsignProvider()
  if (!resolved.ok) {
    return Response.json({ error: resolved.error }, { status: 501 })
  }
  const provider = resolved.provider

  const { id: matterId } = await params
  const admin = getAdminClient()

  const { data: matter } = await admin
    // Consolidated view: an engagement is sent to a lead, so the hired-only
    // view would find nothing for exactly the matters that need this.
    .from('v_matter_pipeline_all')
    .select('matter_id, client_name, client_email, spouse_name, spouse_email')
    .eq('matter_id', matterId)
    .maybeSingle()
  if (!matter) return Response.json({ error: 'Matter not found' }, { status: 404 })
  const clientEmail = matter.client_email?.trim()
  if (!clientEmail) {
    return Response.json({ error: 'Client email is required to send the engagement.' }, { status: 400 })
  }
  const spouseName = matter.spouse_name?.trim() || ''
  const spouseEmail = matter.spouse_email?.trim() || ''
  const hasSpouse = Boolean(spouseName && spouseEmail)

  const { data: details } = await admin
    .from('matter_details')
    .select('engagement_signed, engagement_status, engagement_envelope_id')
    .eq('client_id', matterId)
    .maybeSingle()
  if (details?.engagement_signed) {
    return Response.json({ error: 'Engagement already signed.' }, { status: 409 })
  }

  try {
    if (details?.engagement_envelope_id && details.engagement_status !== 'signed') {
      await provider.cancelEnvelope(details.engagement_envelope_id)
    }

    const { envelopeId, signingLink } = await provider.createEngagementEnvelope({
      primary: { name: matter.client_name ?? 'Client', email: clientEmail },
      ...(hasSpouse ? { spouse: { name: spouseName, email: spouseEmail } } : {}),
    })

    const { data: row, error } = await admin
      .from('matter_details')
      .upsert(
        {
          client_id: matterId,
          engagement_provider: provider.name,
          engagement_envelope_id: envelopeId,
          engagement_status: 'sent',
          engagement_sent_at: new Date().toISOString(),
          engagement_signed_at: null,
        },
        { onConflict: 'client_id' },
      )
      .select()
      .single()
    if (error) throw new Error(error.message)

    return Response.json({ row, signingLink })
  } catch (e) {
    console.error('[engagement send]', e)
    return Response.json(
      { error: e instanceof Error ? e.message : 'Could not send the engagement.' },
      { status: 500 },
    )
  }
}
