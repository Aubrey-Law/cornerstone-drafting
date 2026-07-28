import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { PIPELINE_MATTER_COLUMNS } from '@/lib/queries/matterCore'
import { buildLeadBriefing, buildMatterBriefing, type CallBriefing } from '@/lib/phoneContext'
import { countUnreviewedIntakeUploads, countUnreviewedPortalUploads } from '@/lib/matter/unreviewedUploads'
import type { PipelineMatter } from '@/types/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/phone/context?matterId=… | ?leadId=…
 *
 * One read per call — the softphone asks when a call arrives or is placed,
 * never per keystroke. Returns `{ briefing: null }` for an unmatched number
 * so the UI can render nothing rather than a placeholder.
 */
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const url = new URL(req.url)
  const matterId = url.searchParams.get('matterId')?.trim() || null
  const leadId = url.searchParams.get('leadId')?.trim() || null
  if (!matterId && !leadId) {
    return NextResponse.json({ error: 'matterId or leadId is required' }, { status: 400 })
  }

  const admin = getAdminClient()

  try {
    const briefing = matterId
      ? await matterBriefing(admin, matterId)
      : await leadBriefing(admin, leadId!)
    return NextResponse.json({ briefing })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load call context' },
      { status: 500 },
    )
  }
}

type Admin = ReturnType<typeof getAdminClient>

async function matterBriefing(admin: Admin, matterId: string): Promise<CallBriefing | null> {
  const { data, error } = await admin
    .from('v_matter_pipeline')
    .select(PIPELINE_MATTER_COLUMNS)
    .eq('matter_id', matterId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const matter = data as unknown as PipelineMatter

  const [matterRow, details, unread] = await Promise.all([
    admin.from('matters').select('matter_number, client_intake_id').eq('id', matterId).maybeSingle(),
    admin
      .from('matter_details')
      .select('engagement_signed, engagement_sent_at, engagement_status')
      .eq('matter_id', matterId)
      .maybeSingle(),
    admin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('matter_id', matterId)
      .eq('sender_role', 'client')
      .is('read_at', null),
  ])

  const intakeId = (matterRow.data?.client_intake_id as string | null) ?? null
  const uploads = await countUnreviewedUploads(admin, matterId, intakeId)

  // Same shape the matter page feeds computeMatterNextAction — engagement
  // state lives in matter_details, not on the agreement row.
  const engagement = details.data
    ? {
        signed: Boolean(details.data.engagement_signed),
        sentAt: (details.data.engagement_sent_at as string | null) ?? null,
        status: (details.data.engagement_status as string | null) ?? null,
      }
    : undefined

  return buildMatterBriefing({
    matter,
    matterNumber: (matterRow.data?.matter_number as string | null) ?? null,
    engagement,
    unreadMessages: unread.count ?? 0,
    unreviewedUploads: uploads,
  })
}

/** Upload counts are a nicety — a failure here must not cost us the briefing. */
async function countUnreviewedUploads(
  admin: Admin,
  matterId: string,
  intakeId: string | null,
): Promise<number> {
  try {
    const { data } = await admin
      .from('matters')
      .select('portal_uploads_reviewed_at')
      .eq('id', matterId)
      .maybeSingle()
    const portal = await countUnreviewedPortalUploads(
      admin,
      matterId,
      (data?.portal_uploads_reviewed_at as string | null) ?? null,
    )
    if (!intakeId) return portal
    const { data: intake } = await admin
      .from('client_intake')
      .select('uploads_reviewed_at')
      .eq('id', intakeId)
      .maybeSingle()
    const intakeUploads = await countUnreviewedIntakeUploads(
      admin,
      intakeId,
      (intake?.uploads_reviewed_at as string | null) ?? null,
    )
    return portal + intakeUploads
  } catch {
    return 0
  }
}

async function leadBriefing(admin: Admin, leadId: string): Promise<CallBriefing | null> {
  const { data, error } = await admin
    .from('client_intake')
    .select(
      'id, first_name, last_name, full_name, lead_status, intake_sent_at, intake_completed_at, engagement_fee_quoted, updated_at',
    )
    .eq('id', leadId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null

  const [agreement, lastActivity] = await Promise.all([
    admin
      .from('engagement_agreements')
      .select('status, sent_at, completed_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('lead_activity')
      .select('created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const name =
    (data.full_name as string | null)?.trim() ||
    `${(data.first_name as string | null) ?? ''} ${(data.last_name as string | null) ?? ''}`.trim() ||
    'Lead'

  const status = (agreement.data?.status as string | null) ?? null
  const signed = status === 'completed' || Boolean(agreement.data?.completed_at)

  return buildLeadBriefing({
    leadId,
    name,
    leadStatus: (data.lead_status as string | null) ?? 'lead',
    intakeSentAt: (data.intake_sent_at as string | null) ?? null,
    intakeCompletedAt: (data.intake_completed_at as string | null) ?? null,
    nextAppointmentAt: null,
    feeQuoted: (data.engagement_fee_quoted as number | null) ?? null,
    hasActiveAgreement: Boolean(agreement.data) && status !== 'cancelled' && status !== 'expired',
    agreementSigned: signed,
    lastTouchAt:
      (lastActivity.data?.created_at as string | null) ?? (data.updated_at as string | null) ?? null,
  })
}
