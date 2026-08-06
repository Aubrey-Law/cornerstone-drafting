import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
import { fetchCrmCampaigns } from '@/lib/queries/cornerstoneCrm'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { emailTemplateHtmlToText, sanitizeEmailHtml, textToEmailHtml } from '@/lib/email/templateShared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CAMPAIGN_TYPES = ['newsletter', 'nurture'] as const
const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'] as const
const EMAIL_PROVIDERS = ['sendgrid', 'mailersend', 'resend', 'other'] as const

const createBodySchema = z.object({
  name: z.string().trim().min(1),
  type: z.enum(CAMPAIGN_TYPES),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  emailProvider: z.enum(EMAIL_PROVIDERS).optional(),
  subject: z.string().trim().min(1),
  bodyText: z.string().optional(),
  bodyHtml: z.string().optional(),
  audienceRules: z.object({
    lifecycleStatuses: z.array(z.string()).optional(),
    onlyWithEmail: z.boolean().optional(),
    includeOptedOut: z.boolean().optional(),
    search: z.string().optional(),
    stageIds: z.array(z.string()).optional(),
  }).optional(),
})

function normalizeAudience(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {}
  const raw = input as Record<string, unknown>
  const rules = {
    lifecycleStatuses: Array.isArray(raw.lifecycleStatuses) ? raw.lifecycleStatuses : [],
    onlyWithEmail: raw.onlyWithEmail !== false,
    includeOptedOut: raw.includeOptedOut === true,
    search: typeof raw.search === 'string' ? raw.search.slice(0, 120).trim() : '',
    stageIds: Array.isArray(raw.stageIds) ? raw.stageIds : [],
  }
  return rules
}

function campaignListFilters(req: Request) {
  const url = new URL(req.url)
  const status = url.searchParams.get('status')?.trim()
  const type = url.searchParams.get('type')?.trim()
  const search = url.searchParams.get('search')?.trim() ?? ''

  const nextStatus = status && CAMPAIGN_STATUSES.includes(status as (typeof CAMPAIGN_STATUSES)[number])
    ? (status as (typeof CAMPAIGN_STATUSES)[number])
    : undefined
  const nextType = type && CAMPAIGN_TYPES.includes(type as (typeof CAMPAIGN_TYPES)[number])
    ? (type as (typeof CAMPAIGN_TYPES)[number])
    : undefined

  return {
    status: nextStatus,
    type: nextType,
    search,
  }
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const filters = campaignListFilters(req)
  const { campaigns, error } = await fetchCrmCampaigns(filters)
  if (error) return NextResponse.json({ error }, { status: 500 })

  return NextResponse.json({ campaigns })
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (!auth.err && !auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (auth.err) return auth.err

  const body = await req.json().catch(() => null)
  const parsed = createBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid campaign payload' }, { status: 400 })
  }

  const { name, type, subject, bodyText, bodyHtml, audienceRules } = parsed.data
  const emailProvider = parsed.data.emailProvider ?? 'sendgrid'
  const status = parsed.data.status ?? 'draft'

  const sanitizedHtml = typeof bodyHtml === 'string' ? sanitizeEmailHtml(bodyHtml) : ''
  const fallbackFromText = typeof bodyText === 'string' ? bodyText : ''
  const resolvedText = fallbackFromText.trim() || emailTemplateHtmlToText(sanitizedHtml)
  const resolvedHtml = sanitizedHtml.trim() || textToEmailHtml(resolvedText)

  if (!resolvedText) {
    return NextResponse.json({ error: 'Campaign body is required' }, { status: 400 })
  }

  const admin = getAdminClient()
  const { data, error } = await admin
    .from('cornerstone_crm_campaigns')
    .insert({
      name: name.trim(),
      type,
      status,
      audience_rules: normalizeAudience(audienceRules),
      email_provider: emailProvider,
      subject: subject.trim(),
      body_text: resolvedText,
      body_html: resolvedHtml,
      created_by_user_id: auth.userId,
    })
    .select('id, name, type, status, audience_rules, email_provider, subject, body_text, body_html, created_by_user_id, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(
    {
      campaign: {
        id: data.id,
        name: data.name,
        type: data.type,
        status: data.status,
        audienceRules: normalizeAudience(data.audience_rules),
        emailProvider: data.email_provider,
        subject: data.subject,
        bodyText: data.body_text,
        bodyHtml: data.body_html,
        createdByUserId: data.created_by_user_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        recipientCounts: {
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
        },
      },
    },
    { status: 201 },
  )
}
