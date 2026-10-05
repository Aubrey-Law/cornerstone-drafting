import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { createAgreementDraft } from '@/lib/engagement/repository'
import { markEngagementDraftStatus } from '@/lib/engagement/status'
import { engagementSeedDefinition } from '@/lib/engagement/seed'
import { findResumableEngagementDraft } from '@/lib/engagement/resumableDraft'
import { loadSpouseContact } from '@/lib/contacts/loadSpouseContact'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const { id } = await params
  const admin = getAdminClient()
  const { data: lead } = await admin
    .from('client_intake')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 })
  if (!lead.matter_id) return Response.json({ error: 'Lead opportunity is not initialized' }, { status: 409 })

  const { data: opportunity } = await admin
    .from('matters')
    .select('id, relationship_status')
    .eq('id', lead.matter_id)
    .maybeSingle()
  if (!opportunity || opportunity.relationship_status === 'hired') {
    return Response.json({ error: 'Engagement drafting for this record belongs on the hired matter.' }, { status: 409 })
  }
  if (opportunity.relationship_status === 'lost') {
    return Response.json({ error: 'Reactivate the opportunity before drafting an engagement.' }, { status: 409 })
  }

  const existing = await findResumableEngagementDraft(admin, opportunity.id)
  if (existing) {
    await markEngagementDraftStatus(admin, { matterId: opportunity.id, leadId: id })
    return Response.json({ agreementId: existing.id })
  }

  // Read through the join (step 3 of docs/matter-contacts-migration.md); the
  // opportunity resolved above is the matter.
  const spouse = await loadSpouseContact(admin, opportunity.id as string, '*')
  // A probate lead names its decedent on the intake sheet (probate_details);
  // the opportunity's matter_details copy is the fallback once staff edit it there.
  const { data: details } = await admin
    .from('matter_details')
    .select('pb_decedent_name')
    .eq('client_id', opportunity.id)
    .maybeSingle()
  const probate = (lead.probate_details ?? {}) as { decedent_name?: unknown }
  const primaryEmail = (lead.email || '') as string
  const seed = engagementSeedDefinition({
    practiceArea: lead.practice_area,
    billingType: lead.billing_type,
    spouseEmail: spouse?.email,
    primaryEmail,
    decedentName: (typeof probate.decedent_name === 'string' && probate.decedent_name.trim())
      || details?.pb_decedent_name,
  })
  if (!seed.ok) return Response.json({ error: seed.error }, { status: 400 })

  let result: Awaited<ReturnType<typeof createAgreementDraft>>
  try {
    result = await createAgreementDraft(admin, {
      matterId: opportunity.id,
      preparedBy: userId,
      inputSnapshot: {
        ...seed.definition,
        agreementDate: new Date().toISOString().slice(0, 10),
        primary: {
          name: lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(' '),
          email: primaryEmail,
        },
        spouse: seed.definition.clientMode === 'couple'
          ? { name: [spouse?.first_name, spouse?.last_name].filter(Boolean).join(' '), email: seed.spouseEmail ?? '' }
          : null,
        decedentName: seed.decedentName,
        fee: { amount: Number(lead.engagement_fee_quoted) || 0, paymentTerms: '' },
        optionalClauseKeys: [],
        emailMessage: 'Please review and sign the enclosed engagement agreement.',
        expirationHours: 168,
      },
      renderSha256: 'unrendered',
      masterVersion: '0',
    })
  } catch (error) {
    console.error('Could not create lead engagement draft', { leadId: id, error })
    return Response.json({ error: 'Could not create the engagement draft. Check the client and spouse names and emails, then try again.' }, { status: 500 })
  }

  await markEngagementDraftStatus(admin, { matterId: opportunity.id, leadId: id })
  await admin.from('lead_activity').insert({
    lead_id: id,
    event_type: 'engagement_drafted',
    title: 'Engagement draft created',
    actor_id: userId,
  })

  return Response.json({ agreementId: result.agreementId })
}
