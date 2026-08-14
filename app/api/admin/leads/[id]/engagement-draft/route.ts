import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { createAgreementDraft } from '@/lib/engagement/repository'
import { markEngagementDraftStatus } from '@/lib/engagement/status'
import { normalizePracticeArea } from '@/lib/practiceArea'
import { isSupportedWorkspaceDefinition } from '@/components/engagement/workspaceState'
import { loadSpouseContact } from '@/lib/contacts/loadSpouseContact'

type ExistingAgreement = {
  id: string
  matter_id: string | null
  lead_id: string | null
  active_revision_id: string | null
  active_revision?: { input_snapshot?: Record<string, unknown> | null } | null
}

function canOpenWorkspace(agreement: ExistingAgreement | null): agreement is ExistingAgreement {
  const snapshot = agreement?.active_revision?.input_snapshot
  return Boolean(snapshot && isSupportedWorkspaceDefinition({
    matterId: agreement?.matter_id,
    leadId: agreement?.lead_id,
    ...snapshot,
  }))
}

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

  const { data: existing } = await admin
    .from('engagement_agreements')
    .select('id, matter_id, lead_id, active_revision_id')
    .eq('matter_id', opportunity.id)
    .in('status', ['draft', 'ready', 'failed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const existingAgreement = existing as ExistingAgreement | null
  if (existingAgreement?.active_revision_id) {
    const { data: activeRevision } = await admin
      .from('engagement_agreement_revisions')
      .select('input_snapshot')
      .eq('agreement_id', existingAgreement.id)
      .eq('id', existingAgreement.active_revision_id)
      .maybeSingle()
    existingAgreement.active_revision = activeRevision
  }

  if (canOpenWorkspace(existingAgreement)) {
    await markEngagementDraftStatus(admin, { matterId: opportunity.id, leadId: id })
    return Response.json({ agreementId: existingAgreement.id })
  }

  // Read through the join (step 3 of docs/matter-contacts-migration.md); the
  // opportunity resolved above is the matter.
  const spouse = await loadSpouseContact(admin, opportunity.id as string, '*')
  if (normalizePracticeArea(lead.practice_area) !== 'EP' || !spouse?.email) {
    return Response.json({ error: 'The reviewed workspace currently supports estate-planning couples only; use the legacy engagement flow.' }, { status: 400 })
  }

  const result = await createAgreementDraft(admin, {
    matterId: opportunity.id,
    preparedBy: userId,
    inputSnapshot: {
      practiceArea: 'EP',
      clientMode: 'couple',
      agreementDate: new Date().toISOString().slice(0, 10),
      primary: {
        name: lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(' '),
        email: lead.email || '',
      },
      spouse: {
        name: [spouse.first_name, spouse.last_name].filter(Boolean).join(' '),
        email: spouse.email,
      },
      legalPlan: null,
      fee: { amount: Number(lead.engagement_fee_quoted) || 0, paymentTerms: '' },
      scopeKey: 'standard',
      optionalClauseKeys: [],
      emailMessage: 'Please review and sign the enclosed engagement agreement.',
      expirationHours: 168,
    },
    renderSha256: 'unrendered',
    masterVersion: '0',
  })

  await markEngagementDraftStatus(admin, { matterId: opportunity.id, leadId: id })
  await admin.from('lead_activity').insert({
    lead_id: id,
    event_type: 'engagement_drafted',
    title: 'Engagement draft created',
    actor_id: userId,
  })

  return Response.json({ agreementId: result.agreementId })
}
