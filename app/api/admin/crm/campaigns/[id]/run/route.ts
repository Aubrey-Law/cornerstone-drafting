import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { sendEmail } from '@/lib/email/send'
import { emailTemplateHtmlToText, textToEmailHtml } from '@/lib/email/templateShared'

export const runtime = 'nodejs'
export const maxDuration = 120

const idSchema = z.string().uuid()
const runSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
})

type Context = { params: Promise<{ id: string }> }

type CampaignRecord = {
  id: string
  subject: string | null
  body_text: string | null
  body_html: string | null
  status: string | null
}

type RecipientRow = {
  id: string
  person_id: string
}

type PersonRow = {
  id: string
  email: string | null
  lead_id: string | null
}

function normalizeHtmlText(html: string | null, text: string | null): { html: string; text: string } {
  const resolvedText = (text ?? '').trim() || (html ? emailTemplateHtmlToText(html) : '')
  const resolvedHtml = html && html.trim() ? html : textToEmailHtml(resolvedText)
  return { html: resolvedHtml, text: resolvedText }
}

export async function POST(req: Request, { params }: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const userId = auth.userId
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = await params.then(p => p.id)
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const parsedBody = runSchema.safeParse(body)
  if (!parsedBody.success) return NextResponse.json({ error: 'Invalid run payload' }, { status: 400 })

  const admin = getAdminClient()
  const { data: campaignData, error: campaignError } = await admin
    .from('cornerstone_crm_campaigns')
    .select('id, subject, body_text, body_html, status')
    .eq('id', parsedId.data)
    .maybeSingle()

  if (campaignError) return NextResponse.json({ error: campaignError.message }, { status: 500 })
  if (!campaignData) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const campaign = campaignData as CampaignRecord
  if (campaign.status === 'paused') {
    return NextResponse.json({ error: 'Campaign is paused. Resume before sending.' }, { status: 409 })
  }
  if (campaign.status === 'completed' || campaign.status === 'cancelled') {
    return NextResponse.json({ error: `Campaign is ${campaign.status}` }, { status: 409 })
  }

  const subject = campaign.subject?.trim()
  if (!subject) return NextResponse.json({ error: 'Campaign is missing a subject' }, { status: 400 })

  const content = normalizeHtmlText(campaign.body_html, campaign.body_text)
  if (!content.text) return NextResponse.json({ error: 'Campaign body is empty' }, { status: 400 })

  const limit = parsedBody.data.limit ?? 200
  const { data: queuedRecipients, error: recipientError } = await admin
    .from('cornerstone_crm_campaign_recipients')
    .select('id, person_id')
    .eq('campaign_id', campaign.id)
    .eq('provider_status', 'queued')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (recipientError) return NextResponse.json({ error: recipientError.message }, { status: 500 })

  const queued: RecipientRow[] = queuedRecipients ?? []
  if (!queued.length) {
    return NextResponse.json({
      campaignId: campaign.id,
      sent: 0,
      failed: 0,
      processed: 0,
      nextQueued: 0,
    })
  }

  const peopleIds = queued.map(row => row.person_id)
  const { data: people } = await admin
    .from('cornerstone_crm_people')
    .select('id, email, lead_id')
    .in('id', peopleIds)

  const peopleById = new Map((people ?? []).map(person => [person.id, person as PersonRow]))

  let sent = 0
  let failed = 0

  for (const recipient of queued) {
    const person = peopleById.get(recipient.person_id)
    const to = person?.email?.trim() ?? ''
    if (!to) {
      await admin
        .from('cornerstone_crm_campaign_recipients')
        .update({ provider_status: 'failed', error_code: 'missing_email' })
        .eq('id', recipient.id)
      failed += 1
      continue
    }

    const result = await sendEmail({
      category: 'manual',
      to,
      subject,
      html: content.html,
      text: content.text,
      leadId: person?.lead_id ?? null,
      useStoredTemplate: false,
      userId,
    })

    if (result.ok) {
      await admin.from('cornerstone_crm_campaign_recipients').update({
        provider_status: 'sent',
        provider_message_id: result.resendId ?? null,
        error_code: null,
        last_event_at: new Date().toISOString(),
      }).eq('id', recipient.id)
      sent += 1
      continue
    }

    await admin.from('cornerstone_crm_campaign_recipients').update({
      provider_status: 'failed',
      provider_message_id: null,
      error_code: result.error || `send_failed_${result.status}`,
      last_event_at: new Date().toISOString(),
    }).eq('id', recipient.id)
    failed += 1
  }

  const { count: remaining } = await admin
    .from('cornerstone_crm_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .eq('provider_status', 'queued')

  if (typeof remaining === 'number' && remaining > 0) {
    await admin.from('cornerstone_crm_campaigns').update({ status: 'running' }).eq('id', campaign.id)
  } else {
    await admin.from('cornerstone_crm_campaigns').update({ status: 'completed' }).eq('id', campaign.id)
  }

  return NextResponse.json({
    campaignId: campaign.id,
    sent,
    failed,
    processed: sent + failed,
    nextQueued: remaining ?? 0,
  })
}
