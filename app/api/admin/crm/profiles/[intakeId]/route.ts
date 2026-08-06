import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

const bodySchema = z.object({
  marketingStatus: z.enum(['unknown', 'opted_in', 'opted_out']),
  consentSource: z.string().trim().max(160).optional(),
  marketingSegment: z.enum(['prospect_nurture', 'client_newsletter', 'excluded']).optional(),
})
type Context = { params: Promise<{ intakeId: string }> }

export async function GET(req: Request, { params }: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const intakeId = (await params).intakeId
  const { data, error } = await getAdminClient().from('cornerstone_crm_people')
    .select('id, marketing_status, consent_source, consent_captured_at, unsubscribed_at, marketing_segment, last_engagement_at')
    .eq('client_intake_id', intakeId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profile: data })
}

export async function PUT(req: Request, { params }: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = bodySchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid marketing profile' }, { status: 400 })
  const intakeId = (await params).intakeId
  const now = new Date().toISOString()
  const values = body.data
  const admin = getAdminClient()
  const [{ data: intake, error: intakeError }, { data: stage, error: stageError }, { data: existing }] = await Promise.all([
    admin.from('client_intake').select('id, email, phone').eq('id', intakeId).maybeSingle(),
    admin.from('cornerstone_crm_stages').select('id').eq('is_default', true).maybeSingle(),
    admin.from('cornerstone_crm_people').select('stage_id').eq('client_intake_id', intakeId).maybeSingle(),
  ])
  if (intakeError || !intake) return NextResponse.json({ error: intakeError?.message ?? 'Lead or client record not found' }, { status: 404 })
  if (stageError || !stage) return NextResponse.json({ error: stageError?.message ?? 'A default CRM stage is required' }, { status: 409 })

  const { data, error } = await admin.from('cornerstone_crm_people').upsert({
    client_intake_id: intakeId,
    lead_id: intakeId,
    stage_id: existing?.stage_id ?? stage.id,
    email: intake.email?.trim().toLowerCase() || null,
    phone: intake.phone?.trim() || null,
    normalized_email: intake.email?.trim().toLowerCase() || null,
    normalized_phone: intake.phone?.trim() || null,
    marketing_status: values.marketingStatus,
    marketing_segment: values.marketingSegment ?? 'prospect_nurture',
    consent_source: values.marketingStatus === 'opted_in' ? (values.consentSource || 'staff_recorded') : null,
    consent_captured_at: values.marketingStatus === 'opted_in' ? now : null,
    consent_captured_by: values.marketingStatus === 'opted_in' ? auth.userId : null,
    unsubscribed_at: values.marketingStatus === 'opted_out' ? now : null,
  }, { onConflict: 'client_intake_id' }).select('id, marketing_status, consent_source, consent_captured_at, unsubscribed_at, marketing_segment, last_engagement_at').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profile: data })
}
