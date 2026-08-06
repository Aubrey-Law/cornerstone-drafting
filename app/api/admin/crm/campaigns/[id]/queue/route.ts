import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/apiAuth'
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
}

function audienceFilterQuery(admin: ReturnType<typeof getAdminClient>, rules: AudienceRules) {
  let query = admin
    .from('cornerstone_crm_people')
    .select('id, email, first_name, last_name, lead_id, cornerstone_matter_id, company_name, city')
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

  if (!rules.includeOptedOut) query = query.eq('campaign_opt_out', false)
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

export async function POST(req: Request, { params }: Context) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const id = await params.then(p => p.id)
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid campaign id' }, { status: 400 })

  const admin = getAdminClient()
  const { data: campaign, error: campaignError } = await admin
    .from('cornerstone_crm_campaigns')
    .select('id, audience_rules, status')
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

  const valid = audienceRules.onlyWithEmail
    ? peopleList.filter(row => !!row.email?.trim())
    : peopleList

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
  const { data: upserted, error: upsertError } = await admin
    .from('cornerstone_crm_campaign_recipients')
    .upsert(recipientRows, { onConflict: 'campaign_id,person_id', ignoreDuplicates: false })
    .select('person_id')

  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 })

  const affectedRows = upserted ?? recipientRows
  const addedCount = recipientRows.filter(row => !existingSet.has(row.person_id)).length

  await admin
    .from('cornerstone_crm_campaigns')
    .update({ status: 'running' })
    .eq('id', campaign.id)

  return NextResponse.json({
    campaignId: campaign.id,
    queued: affectedRows.length,
    added: addedCount,
    updated: Math.max(0, affectedRows.length - addedCount),
    sampleRecipients: valid.slice(0, 3).map(person => personName(person)),
  })
}
