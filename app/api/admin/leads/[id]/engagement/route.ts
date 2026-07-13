import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { resolveEsignProvider } from '@/lib/esign/firma'

/**
 * POST /api/admin/leads/[id]/engagement — send (or re-send) the engagement
 * agreement to a lead's matter-owned opportunity. On signing, the webhook
 * promotes that existing opportunity to Hired.
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
  const body = (await req.json().catch(() => ({}))) as {
    primaryName?: string
    primaryEmail?: string
    spouseName?: string
    spouseEmail?: string
    feeQuoted?: number | null
  }
  const admin = getAdminClient()

  const { data: lead } = await admin
    .from('client_intake')
    .select('id, matter_id, email, first_name, last_name, full_name, engagement_status, engagement_envelope_id')
    .eq('id', intakeId)
    .maybeSingle()
  if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 })
  if (!lead.matter_id) return Response.json({ error: 'Lead opportunity is not initialized' }, { status: 409 })
  const { data: opportunity } = await admin
    .from('matters')
    .select('id, relationship_status')
    .eq('id', lead.matter_id)
    .maybeSingle()
  if (!opportunity || opportunity.relationship_status !== 'lead') {
    return Response.json({ error: opportunity?.relationship_status === 'lost' ? 'Reactivate the opportunity before sending an engagement.' : 'Engagement already belongs to the hired matter.' }, { status: 409 })
  }

  const primaryName =
    body.primaryName?.trim() ||
    lead.full_name?.trim() ||
    [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() ||
    'Client'
  const primaryEmail = (body.primaryEmail?.trim() || lead.email || '').trim().toLowerCase()
  if (!primaryEmail) {
    return Response.json({ error: 'Lead email is required to send the engagement.' }, { status: 400 })
  }
  const spouseName = body.spouseName?.trim() || ''
  const spouseEmail = body.spouseEmail?.trim().toLowerCase() || ''
  const hasSpouse = Boolean(spouseName && spouseEmail)

  if (lead.engagement_status === 'signed') {
    return Response.json({ error: 'Engagement already signed.' }, { status: 409 })
  }
  try {
    if (lead.engagement_envelope_id) {
      await provider.cancelEnvelope(lead.engagement_envelope_id)
    }

    // Persist any primary edits + quoted fee back onto the lead so they carry
    // into the matter on conversion.
    const parts = primaryName.split(/\s+/)
    const primaryUpdate: Record<string, unknown> = {
      full_name: primaryName,
      first_name: parts[0] ?? primaryName,
      last_name: parts.slice(1).join(' ') || null,
      email: primaryEmail,
    }
    if (body.feeQuoted !== undefined) {
      primaryUpdate.engagement_fee_quoted =
        typeof body.feeQuoted === 'number' && Number.isFinite(body.feeQuoted) ? body.feeQuoted : null
    }

    // Spouse is stored as a contacts row so v_matter_pipeline surfaces it and
    // it carries into the matter on conversion.
    if (hasSpouse) {
      const sParts = spouseName.split(/\s+/)
      const spouseFields = {
        first_name: sParts[0] ?? spouseName,
        last_name: sParts.slice(1).join(' ') || null,
        email: spouseEmail,
      }
      const { data: existingSpouse } = await admin
        .from('contacts')
        .select('id')
        .eq('client_intake_id', intakeId)
        .eq('relationship_type', 'spouse')
        .maybeSingle()
      if (existingSpouse) {
        await admin.from('contacts').update(spouseFields).eq('id', existingSpouse.id)
      } else {
        await admin
          .from('contacts')
          .insert({ client_intake_id: intakeId, relationship_type: 'spouse', ...spouseFields })
      }
    }

    const { envelopeId, signingLink } = await provider.createEngagementEnvelope({
      primary: { name: primaryName, email: primaryEmail },
      ...(hasSpouse ? { spouse: { name: spouseName, email: spouseEmail } } : {}),
    })

    const { data: row, error } = await admin
      .from('client_intake')
      .update({
        ...primaryUpdate,
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

    const { error: detailsError } = await admin.from('matter_details').upsert(
      {
        client_id: opportunity.id,
        engagement_provider: provider.name,
        engagement_envelope_id: envelopeId,
        engagement_status: 'sent',
        engagement_sent_at: new Date().toISOString(),
        engagement_signed_at: null,
        flat_fee_amount: primaryUpdate.engagement_fee_quoted ?? undefined,
      },
      { onConflict: 'client_id' },
    )
    if (detailsError) throw new Error(detailsError.message)

    return Response.json({ row, signingLink })
  } catch (e) {
    console.error('[lead engagement send]', e)
    return Response.json(
      { error: e instanceof Error ? e.message : 'Could not send the engagement.' },
      { status: 500 },
    )
  }
}
