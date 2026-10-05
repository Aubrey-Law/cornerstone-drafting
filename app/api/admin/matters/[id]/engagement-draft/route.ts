import { requireAdmin } from '@/lib/apiAuth'
import { createAgreementDraft } from '@/lib/engagement/repository'
import { markEngagementDraftStatus } from '@/lib/engagement/status'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { engagementSeedDefinition } from '@/lib/engagement/seed'
import { findResumableEngagementDraft } from '@/lib/engagement/resumableDraft'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params
  const admin = getAdminClient()
  const existing = await findResumableEngagementDraft(admin, matterId)
  if (existing) {
    await markEngagementDraftStatus(admin, { matterId })
    return Response.json({ agreementId: existing.id })
  }

  const { data: matter } = await admin
    // Consolidated view: an engagement is sent to a lead, so the hired-only
    // view would find nothing for exactly the matters that need this.
    .from('v_matter_pipeline_all')
    .select('matter_id, client_name, client_email, spouse_name, spouse_email, practice_area, fee_amount')
    .eq('matter_id', matterId)
    .maybeSingle()
  if (!matter) return Response.json({ error: 'Hired matter not found' }, { status: 404 })

  // The pipeline view carries neither: an LP letter names the plan, and a
  // probate agreement is addressed to the estate of the decedent.
  const { data: details } = await admin
    .from('matter_details')
    .select('billing_type, pb_decedent_name')
    .eq('client_id', matterId)
    .maybeSingle()

  const seed = engagementSeedDefinition({
    practiceArea: matter.practice_area,
    billingType: details?.billing_type,
    spouseEmail: matter.spouse_email,
    primaryEmail: matter.client_email,
    decedentName: details?.pb_decedent_name,
  })
  if (!seed.ok) return Response.json({ error: seed.error }, { status: 400 })

  let result: Awaited<ReturnType<typeof createAgreementDraft>>
  try {
    result = await createAgreementDraft(admin, {
      matterId,
      preparedBy: userId,
      inputSnapshot: {
        ...seed.definition,
        agreementDate: new Date().toISOString().slice(0, 10),
        primary: { name: matter.client_name || 'Client', email: matter.client_email || '' },
        spouse: seed.definition.clientMode === 'couple' ? { name: matter.spouse_name || 'Spouse', email: seed.spouseEmail ?? '' } : null,
        decedentName: seed.decedentName,
        fee: { amount: Number(matter.fee_amount) || 0, paymentTerms: '' },
        optionalClauseKeys: [],
        emailMessage: 'Please review and sign the enclosed engagement agreement.',
        expirationHours: 168,
      },
      renderSha256: 'unrendered',
      masterVersion: '0',
    })
  } catch (error) {
    console.error('Could not create matter engagement draft', { matterId, error })
    return Response.json({ error: 'Could not create the engagement draft. Check the client and spouse names and emails, then try again.' }, { status: 500 })
  }

  await markEngagementDraftStatus(admin, { matterId })
  await admin.from('matter_activity').insert({
    matter_id: matterId,
    event_type: 'engagement_drafted',
    title: 'Engagement draft created',
    actor_id: userId,
  })
  return Response.json({ agreementId: result.agreementId })
}
