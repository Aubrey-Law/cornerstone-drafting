import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { resolveEsignProvider } from '@/lib/esign/firma'

/**
 * POST /api/admin/leads/[id]/engagement — send (or re-send) the engagement
 * agreement to a lead (a client_intake row with no matter yet). On signing,
 * the /api/webhooks/esign handler converts the lead into a matter.
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

  const { id: intakeId } = await params
  const admin = getAdminClient()

  const { data: lead } = await admin
    .from('client_intake')
    .select('id, email, first_name, last_name, full_name, engagement_status, engagement_envelope_id')
    .eq('id', intakeId)
    .maybeSingle()
  if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 })
  const clientEmail = lead.email?.trim()
  if (!clientEmail) {
    return Response.json({ error: 'Lead email is required to send the engagement.' }, { status: 400 })
  }
  if (lead.engagement_status === 'signed') {
    return Response.json({ error: 'Engagement already signed.' }, { status: 409 })
  }
  const { data: existingMatter } = await admin
    .from('matters')
    .select('id')
    .eq('client_intake_id', intakeId)
    .maybeSingle()
  if (existingMatter) {
    return Response.json(
      { error: 'Lead already converted — send the engagement from the matter page.' },
      { status: 409 },
    )
  }

  try {
    if (lead.engagement_envelope_id) {
      await provider.cancelEnvelope(lead.engagement_envelope_id)
    }

    const clientName =
      lead.full_name?.trim() ||
      [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() ||
      'Client'
    const { envelopeId } = await provider.createEngagementEnvelope({
      name: clientName,
      email: clientEmail,
    })

    const { data: row, error } = await admin
      .from('client_intake')
      .update({
        engagement_provider: provider.name,
        engagement_envelope_id: envelopeId,
        engagement_status: 'sent',
        engagement_sent_at: new Date().toISOString(),
        engagement_signed_at: null,
      })
      .eq('id', intakeId)
      .select('id, engagement_status, engagement_sent_at')
      .single()
    if (error) throw new Error(error.message)

    return Response.json({ row })
  } catch (e) {
    console.error('[lead engagement send]', e)
    return Response.json(
      { error: e instanceof Error ? e.message : 'Could not send the engagement.' },
      { status: 500 },
    )
  }
}
