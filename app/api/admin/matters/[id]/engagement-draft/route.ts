import { requireAdmin } from '@/lib/apiAuth'
import { createAgreementDraft } from '@/lib/engagement/repository'
import { markEngagementDraftStatus } from '@/lib/engagement/status'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { engagementSeedDefinition } from '@/lib/engagement/seed'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const { id: matterId } = await params
  const admin = getAdminClient()
  const { data: existing } = await admin
    .from('engagement_agreements')
    .select('id')
    .eq('matter_id', matterId)
    .in('status', ['draft', 'ready', 'failed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
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

  // The pipeline view carries no billing type, and an LP letter names the plan.
  const { data: details } = await admin
    .from('matter_details')
    .select('billing_type')
    .eq('client_id', matterId)
    .maybeSingle()

  const seed = engagementSeedDefinition({
    practiceArea: matter.practice_area,
    billingType: details?.billing_type,
    spouseEmail: matter.spouse_email,
  })
  if (!seed.ok) return Response.json({ error: seed.error }, { status: 400 })

  const result = await createAgreementDraft(admin, {
    matterId,
    preparedBy: userId,
    inputSnapshot: {
      ...seed.definition,
      agreementDate: new Date().toISOString().slice(0, 10),
      primary: { name: matter.client_name || 'Client', email: matter.client_email || '' },
      spouse: seed.spouseEmail ? { name: matter.spouse_name || 'Spouse', email: seed.spouseEmail } : null,
      fee: { amount: Number(matter.fee_amount) || 0, paymentTerms: '' },
      optionalClauseKeys: [],
      emailMessage: 'Please review and sign the enclosed engagement agreement.',
      expirationHours: 168,
    },
    renderSha256: 'unrendered',
    masterVersion: '0',
  })

  await markEngagementDraftStatus(admin, { matterId })
  await admin.from('matter_activity').insert({
    matter_id: matterId,
    event_type: 'engagement_drafted',
    title: 'Engagement draft created',
    actor_id: userId,
  })
  return Response.json({ agreementId: result.agreementId })
}
