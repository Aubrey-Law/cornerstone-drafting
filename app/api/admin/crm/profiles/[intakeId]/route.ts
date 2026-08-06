import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

const bodySchema = z.object({
  marketingStatus: z.enum(['unknown', 'opted_in', 'opted_out']).optional(),
  consentSource: z.string().trim().max(160).optional(),
  marketingSegment: z.enum(['prospect_nurture', 'client_newsletter', 'excluded']).optional(),
  topicPreferences: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  preferredFrequency: z.enum(['monthly', 'quarterly', 'as_needed']).nullable().optional(),
  duplicateReviewStatus: z.enum(['unreviewed', 'reviewed', 'merged']).optional(),
})
type Context = { params: Promise<{ intakeId: string }> }

async function resolveMarketingProfileStage(admin: ReturnType<typeof getAdminClient>) {
  const preferred = await admin
    .from('cornerstone_crm_stages')
    .select('id')
    .eq('slug', 'new_inquiry')
    .eq('is_active', true)
    .maybeSingle()

  if (preferred.error || preferred.data) return preferred

  return admin
    .from('cornerstone_crm_stages')
    .select('id')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle()
}

export async function GET(req: Request, { params }: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const intakeId = (await params).intakeId
  const { data, error } = await getAdminClient().from('cornerstone_crm_people')
    .select('id, marketing_status, consent_source, consent_captured_at, unsubscribed_at, marketing_segment, topic_preferences, preferred_frequency, duplicate_review_status, last_engagement_at')
    .eq('client_intake_id', intakeId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const { data: intake } = await getAdminClient().from('client_intake').select('email, phone').eq('id', intakeId).maybeSingle()
  const email = intake?.email?.trim().toLowerCase()
  const phone = intake?.phone?.trim()
  let duplicateCount = 0
  if (email || phone) {
    let duplicateQuery = getAdminClient().from('cornerstone_crm_people').select('id', { count: 'exact', head: true }).neq('client_intake_id', intakeId)
    if (email && phone) duplicateQuery = duplicateQuery.or(`normalized_email.eq.${email},normalized_phone.eq.${phone}`)
    else if (email) duplicateQuery = duplicateQuery.eq('normalized_email', email)
    else if (phone) duplicateQuery = duplicateQuery.eq('normalized_phone', phone)
    const { count } = await duplicateQuery
    duplicateCount = count ?? 0
  }
  return NextResponse.json({ profile: data, duplicateCount })
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
    resolveMarketingProfileStage(admin),
    admin.from('cornerstone_crm_people').select('stage_id, marketing_status, marketing_segment, topic_preferences, preferred_frequency, duplicate_review_status').eq('client_intake_id', intakeId).maybeSingle(),
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
    marketing_status: values.marketingStatus ?? existing?.marketing_status ?? 'unknown',
    marketing_segment: values.marketingSegment ?? existing?.marketing_segment ?? 'prospect_nurture',
    topic_preferences: values.topicPreferences ?? existing?.topic_preferences ?? [],
    preferred_frequency: values.preferredFrequency ?? existing?.preferred_frequency ?? null,
    duplicate_review_status: values.duplicateReviewStatus ?? existing?.duplicate_review_status ?? 'unreviewed',
    consent_source: values.marketingStatus === 'opted_in' ? (values.consentSource || 'staff_recorded') : undefined,
    consent_captured_at: values.marketingStatus === 'opted_in' ? now : undefined,
    consent_captured_by: values.marketingStatus === 'opted_in' ? auth.userId : undefined,
    unsubscribed_at: values.marketingStatus === 'opted_out' ? now : undefined,
  }, { onConflict: 'client_intake_id' }).select('id, marketing_status, consent_source, consent_captured_at, unsubscribed_at, marketing_segment, topic_preferences, preferred_frequency, duplicate_review_status, last_engagement_at').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profile: data })
}
