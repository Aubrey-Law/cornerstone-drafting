import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

const idSchema = z.string().uuid()
const stepSchema = z.object({
  subject: z.string().trim().min(1),
  bodyText: z.string().trim().min(1),
  delayDays: z.number().int().min(0).max(3650),
})
type Context = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const id = (await params).id
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })
  const { data, error } = await getAdminClient().from('cornerstone_crm_campaign_steps')
    .select('id, step_order, delay_days, subject, body_text, is_active')
    .eq('campaign_id', id)
    .order('step_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ steps: data ?? [] })
}

export async function POST(req: Request, { params }: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const id = (await params).id
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })
  const body = stepSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'Invalid nurture step' }, { status: 400 })

  const admin = getAdminClient()
  const { data: campaign } = await admin.from('cornerstone_crm_campaigns').select('type, status').eq('id', id).maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  if (campaign.type !== 'nurture') return NextResponse.json({ error: 'Only nurture campaigns can have additional steps' }, { status: 409 })
  if (campaign.status !== 'draft') return NextResponse.json({ error: 'Edit nurture steps before queueing recipients' }, { status: 409 })

  const { count } = await admin.from('cornerstone_crm_campaign_steps')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', id)
  const { data, error } = await admin.from('cornerstone_crm_campaign_steps').insert({
    campaign_id: id,
    step_order: (count ?? 0) + 1,
    delay_days: body.data.delayDays,
    subject: body.data.subject,
    body_text: body.data.bodyText,
    body_html: `<p>${body.data.bodyText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`,
  }).select('id, step_order, delay_days, subject, body_text, is_active').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ step: data }, { status: 201 })
}
