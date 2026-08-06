import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
import { createDeliveryToken, unsubscribeTokenHash } from '@/lib/crm/mailgunCampaigns'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { parseCampaignAudienceRules, type CrmPeopleFilter } from '@/lib/queries/cornerstoneCrm'

export const runtime = 'nodejs'

const idSchema = z.string().uuid()
const MAX_CAMPAIGN_AUDIENCE = 1000

type Context = { params: Promise<{ id: string }> }

type AudienceRules = ReturnType<typeof parseCampaignAudienceRules>

type CampaignPersonRow = {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  lead_id: string | null
  cornerstone_matter_id: string | null
  marketing_status: 'unknown' | 'opted_in' | 'opted_out'
}

function audienceFilterQuery(admin: ReturnType<typeof getAdminClient>, rules: AudienceRules) {
  let query = admin
    .from('cornerstone_crm_people')
    .select('id, email, first_name, last_name, lead_id, cornerstone_matter_id, company_name, city, marketing_status')
    .limit(MAX_CAMPAIGN_AUDIENCE)

  if (rules.search) {
    const safe = rules.search.replace(/[%_]/g, '\\$&')
    query = query.or([
      `first_name.ilike.%${safe}%`,
      `last_name.ilike.%${safe}%`,
      `email.ilike.%${safe}%`,
      `company_name.ilike.%${safe}%`,
      `city.ilike.%${safe}%`,
    ].join(','))
  }

  if (rules.stageIds.length) query = query.in('stage_id', rules.stageIds)
  if (rules.onlyWithEmail) {
    query = query.not('email', 'is', null).neq('email', '')
  }

  query = query.eq('marketing_status', 'opted_in')
  const lifecycleStatuses = rules.lifecycleStatuses
    .filter(Boolean)
    .filter((value): value is CrmPeopleFilter['lifecycle'] => value !== 'all')

  if (lifecycleStatuses.length) query = query.in('lifecycle_status', lifecycleStatuses)
  return query
}

function personName(person: { first_name: string | null; last_name: string | null; email: string | null }) {
  const fullName = [person.first_name, person.last_name].filter(Boolean).join(' ').trim()
  return fullName || person.email || 'Contact'
}

async function previewAudience(req: Request, context: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const id = (await context.params).id
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })

  const admin = getAdminClient()
  const { data: campaign, error: campaignError } = await admin
    .from('cornerstone_crm_campaigns')
    .select('id, audience_rules, status, type')
    .eq('id', parsedId.data)
    .maybeSingle()

  if (campaignError) return NextResponse.json({ error: campaignError.message }, { status: 500 })
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  if (campaign.status === 'completed' || campaign.status === 'cancelled') {
    return NextResponse.json({ error: `Campaign is ${campaign.status}` }, { status: 409 })
  }

  const audienceRules = parseCampaignAudienceRules(campaign.audience_rules)
  const peopleQuery = audienceFilterQuery(admin, audienceRules)

  const { data: selectedPeople, error: peopleError } = await peopleQuery
  if (peopleError) return NextResponse.json({ error: peopleError.message }, { status: 500 })

  const peopleList = (selectedPeople ?? []) as CampaignPersonRow[]

  const valid = peopleList.filter(row => {
    if (row.marketing_status !== 'opted_in') return false
    if (campaign.type === 'nurture' && row.cornerstone_matter_id) return false
    return !audienceRules.onlyWithEmail || !!row.email?.trim()
  })

  const missingConsent = peopleList.filter(row => row.marketing_status !== 'opted_in').length
  const clientExcluded = campaign.type === 'nurture'
    ? peopleList.filter(row => row.marketing_status === 'opted_in' && !!row.cornerstone_matter_id).length
    : 0
  const missingEmail = audienceRules.onlyWithEmail
    ? peopleList.filter(row => !row.email?.trim()).length
    : 0
  return { campaign, audienceRules, peopleList, valid, missingConsent, clientExcluded, missingEmail }
}

export async function GET(req: Request, { params }: Context) {
  const result = await previewAudience(req, params)
  if (result instanceof NextResponse) return result
  return NextResponse.json({
    eligible: result.valid.length,
    excluded: result.peopleList.length - result.valid.length,
    exclusionReasons: {
      missingExplicitConsent: result.missingConsent,
      clientsExcludedFromNurture: result.clientExcluded,
      missingEmail: result.missingEmail,
    },
    sampleRecipients: result.valid.slice(0, 5).map(person => personName(person)),
  })
}

export async function POST(req: Request, { params }: Context) {
  const result = await previewAudience(req, params)
  if (result instanceof NextResponse) return result
  const { campaign, valid } = result
  const admin = getAdminClient()

  if (!valid.length) {
    return NextResponse.json({ queued: 0, added: 0, updated: 0, campaignId: campaign.id })
  }

  const recipientRows = valid.map(person => ({
    campaign_id: campaign.id,
    person_id: person.id,
    provider_status: 'queued',
    provider_message_id: null,
    error_code: null,
    external_url: null,
  }))

  const { data: existing } = await admin
    .from('cornerstone_crm_campaign_recipients')
    .select('person_id')
    .eq('campaign_id', campaign.id)

  const existingSet = new Set((existing ?? []).map(row => row.person_id as string))
  const { error: upsertError } = await admin
    .from('cornerstone_crm_campaign_recipients')
    .upsert(recipientRows, { onConflict: 'campaign_id,person_id', ignoreDuplicates: true })

  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 })

  const { data: recipients, error: recipientsError } = await admin
    .from('cornerstone_crm_campaign_recipients')
    .select('id, person_id')
    .eq('campaign_id', campaign.id)
    .in('person_id', valid.map(person => person.id))
  if (recipientsError) return NextResponse.json({ error: recipientsError.message }, { status: 500 })

  const { data: steps, error: stepsError } = await admin
    .from('cornerstone_crm_campaign_steps')
    .select('id, delay_days')
    .eq('campaign_id', campaign.id)
    .eq('is_active', true)
  if (stepsError) return NextResponse.json({ error: stepsError.message }, { status: 500 })

  const now = Date.now()
  const deliveryRows = (recipients ?? []).flatMap(recipient => (steps ?? []).map(step => {
    const token = createDeliveryToken()
    return {
      campaign_id: campaign.id,
      campaign_recipient_id: recipient.id,
      step_id: step.id,
      scheduled_at: new Date(now + step.delay_days * 24 * 60 * 60 * 1000).toISOString(),
      delivery_token: token,
      delivery_token_hash: unsubscribeTokenHash(token),
    }
  }))
  if (deliveryRows.length) {
    const { error: deliveryError } = await admin
      .from('cornerstone_crm_campaign_deliveries')
      .upsert(deliveryRows, { onConflict: 'campaign_recipient_id,step_id', ignoreDuplicates: true })
    if (deliveryError) return NextResponse.json({ error: deliveryError.message }, { status: 500 })
  }

  const addedCount = recipientRows.filter(row => !existingSet.has(row.person_id)).length

  await admin
    .from('cornerstone_crm_campaigns')
    .update({ status: 'running' })
    .eq('id', campaign.id)

  return NextResponse.json({
    campaignId: campaign.id,
    queued: deliveryRows.length,
    added: addedCount,
    updated: 0,
    sampleRecipients: valid.slice(0, 3).map(person => personName(person)),
  })
}
