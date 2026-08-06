import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { emailTemplateHtmlToText, sanitizeEmailHtml, textToEmailHtml } from '@/lib/email/templateShared'
import { parseCampaignAudienceRules, type CrmCampaignType, type CrmCampaignStatus } from '@/lib/queries/cornerstoneCrm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const idSchema = z.string().uuid()
const statusValues = ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'] as const
const typeValues = ['newsletter', 'nurture'] as const
const providerValues = ['sendgrid', 'mailersend', 'resend', 'other'] as const

type Context = { params: Promise<{ id: string }> }

const patchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  type: z.enum(typeValues).optional(),
  status: z.enum(statusValues).optional(),
  emailProvider: z.enum(providerValues).optional(),
  subject: z.string().trim().min(1).optional(),
  bodyText: z.string().optional(),
  bodyHtml: z.string().optional(),
  audienceRules: z.object({
    lifecycleStatuses: z.array(z.string()).optional(),
    onlyWithEmail: z.boolean().optional(),
    includeOptedOut: z.boolean().optional(),
    search: z.string().optional(),
    stageIds: z.array(z.string()).optional(),
  }).optional(),
}).partial()

function normalizePayload(body: Record<string, unknown>) {
  const updates: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim()
  if (typeof body.type === 'string') updates.type = body.type
  if (typeof body.status === 'string') updates.status = body.status
  if (typeof body.emailProvider === 'string') updates.email_provider = body.emailProvider
  if (typeof body.subject === 'string' && body.subject.trim()) updates.subject = body.subject.trim()

  const bodyTextProvided = typeof body.bodyText === 'string'
  const bodyHtmlProvided = typeof body.bodyHtml === 'string'

  if (bodyTextProvided || bodyHtmlProvided) {
    const htmlSource = bodyHtmlProvided ? sanitizeEmailHtml(body.bodyHtml as string) : ''
    const textSource = bodyTextProvided
      ? (body.bodyText as string).trim()
      : htmlSource
        ? emailTemplateHtmlToText(htmlSource)
        : ''

    if (textSource) {
      updates.body_text = textSource
      updates.body_html = htmlSource || textToEmailHtml(textSource)
    }
  }

  if (body.audienceRules && typeof body.audienceRules === 'object') {
    updates.audience_rules = parseCampaignAudienceRules(body.audienceRules)
  }

  return updates
}

export async function GET(_req: Request, { params }: Context) {
  const auth = await requireAdmin(_req)
  if (auth.err) return auth.err

  const id = await params.then(p => p.id)
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('cornerstone_crm_campaigns')
    .select('id, name, type, status, audience_rules, email_provider, provider_template_id, send_schedule_cron_or_date, subject, body_text, body_html, created_by_user_id, created_at, updated_at')
    .eq('id', parsedId.data)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const { data: recipients, error: recipientError } = await admin
    .from('cornerstone_crm_campaign_recipients')
    .select('campaign_id, provider_status')
    .eq('campaign_id', parsedId.data)

  if (recipientError) return NextResponse.json({ error: recipientError.message }, { status: 500 })

  const counts = {
    total: 0,
    queued: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    failed: 0,
    complaint: 0,
    unsubscribed: 0,
  }
  for (const row of recipients ?? []) {
    counts.total += 1
    const status = (row as { provider_status: string | null }).provider_status
    if (status === 'queued') counts.queued += 1
    if (status === 'sent') counts.sent += 1
    if (status === 'delivered') counts.delivered += 1
    if (status === 'opened') counts.opened += 1
    if (status === 'clicked') counts.clicked += 1
    if (status === 'bounced') counts.bounced += 1
    if (status === 'failed') counts.failed += 1
    if (status === 'complaint') counts.complaint += 1
    if (status === 'unsubscribed') counts.unsubscribed += 1
  }

  return NextResponse.json({
    campaign: {
      id: data.id,
      name: data.name,
      type: data.type as CrmCampaignType,
      status: data.status as CrmCampaignStatus,
      audienceRules: parseCampaignAudienceRules(data.audience_rules),
      emailProvider: data.email_provider,
      subject: data.subject,
      bodyText: data.body_text,
      bodyHtml: data.body_html,
      providerTemplateId: (data as { provider_template_id: string | null }).provider_template_id,
      sendScheduleCronOrDate: (data as { send_schedule_cron_or_date: string | null })
        .send_schedule_cron_or_date,
      createdByUserId: data.created_by_user_id,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      recipientCounts: counts,
    },
  })
}

export async function PATCH(req: Request, { params }: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const id = await params.then(p => p.id)
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })

  const body = await req.json().catch(() => null)
  const parsedBody = patchSchema.safeParse(body)
  if (!parsedBody.success) return NextResponse.json({ error: 'Invalid campaign payload' }, { status: 400 })
  const updates = normalizePayload(parsedBody.data as Record<string, unknown>)
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'No campaign fields to update' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('cornerstone_crm_campaigns')
    .update(updates)
    .eq('id', parsedId.data)
    .select('id, name, type, status, audience_rules, email_provider, subject, body_text, body_html, created_by_user_id, created_at, updated_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  return NextResponse.json({
    campaign: {
      id: data.id,
      name: data.name,
      type: data.type,
      status: data.status,
      audienceRules: parseCampaignAudienceRules((data as { audience_rules?: unknown }).audience_rules),
      emailProvider: data.email_provider,
      subject: data.subject,
      bodyText: data.body_text,
      bodyHtml: data.body_html,
      createdByUserId: data.created_by_user_id,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  })
}
