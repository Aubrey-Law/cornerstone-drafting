import { requireAdmin } from '@/lib/apiAuth'
import { createAgreementDraft } from '@/lib/engagement/repository'
import { markEngagementDraftStatus } from '@/lib/engagement/status'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { normalizePracticeArea } from '@/lib/practiceArea'

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
    .from('v_matter_pipeline')
    .select('matter_id, client_name, client_email, spouse_name, spouse_email, practice_area, fee_amount')
    .eq('matter_id', matterId)
    .maybeSingle()
  if (!matter) return Response.json({ error: 'Hired matter not found' }, { status: 404 })
  if (normalizePracticeArea(matter.practice_area) !== 'EP' || !matter.spouse_email) {
    return Response.json({ error: 'The reviewed workspace currently supports estate-planning couples only; use the legacy engagement flow.' }, { status: 400 })
  }

  const result = await createAgreementDraft(admin, {
    matterId,
    preparedBy: userId,
    inputSnapshot: {
      practiceArea: 'EP',
      clientMode: 'couple',
      agreementDate: new Date().toISOString().slice(0, 10),
      primary: { name: matter.client_name || 'Client', email: matter.client_email || '' },
      spouse: { name: matter.spouse_name || 'Spouse', email: matter.spouse_email },
      legalPlan: null,
      fee: { amount: Number(matter.fee_amount) || 0, paymentTerms: '' },
      scopeKey: 'standard',
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
