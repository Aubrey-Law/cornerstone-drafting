import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CrmLifecycle = 'new' | 'contacted' | 'nurture' | 'qualified' | 'working' | 'converted' | 'closed_lost'

type ImportMode = 'append' | 'refresh'

interface ImportLeadRow {
  id: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  country: string | null
  lead_source: string | null
  referral_source: string | null
  lead_status: string | null
  matter_id: string | null
  user_id: string | null
}

function mapLifecycle(status: string | null): CrmLifecycle {
  if (!status) return 'new'

  const normalized = status.trim().toLowerCase()
  if (['lost', 'declined', 'disqualified', 'no_thank_you'].includes(normalized)) return 'closed_lost'
  if (['converted', 'hired', 'client', 'client_active', 'active_client'].includes(normalized)) return 'converted'
  if (['qualified', 'nurture', 'nurturing', 'follow_up', 'follow-up', 'followup'].includes(normalized)) return 'qualified'
  if (['contacted', 'in_discussion', 'intro', 'initial_contact', 'discovery', 'discovery_scheduled', 'discovery_call', 'engaged', 'email_started', 'intake_started', 'scheduled'].includes(normalized)) {
    return 'contacted'
  }
  if (['working', 'proposal', 'proposal_sent', 'proposal_in_review', 'signed', 'retainer', 'engagement', 'intake_complete'].includes(normalized)) {
    return 'working'
  }
  return 'new'
}

function parseRequestMode(body: unknown): ImportMode {
  if (body && typeof body === 'object' && (body as { mode?: unknown }).mode === 'refresh') {
    return 'refresh'
  }
  return 'append'
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const body = await req.json().catch(() => ({}))
  const mode = parseRequestMode(body)
  const admin = getAdminClient()

  const [stageResult, leadsResult] = await Promise.all([
    admin
      .from('cornerstone_crm_stages')
      .select('id, name')
      .eq('slug', 'new_inquiry')
      .maybeSingle(),
    admin
      .from('client_intake')
      .select('id, first_name, last_name, full_name, email, phone, city, state, country, lead_source, referral_source, lead_status, matter_id, user_id')
      .not('lead_status', 'is', null)
      .neq('lead_status', 'hired')
      .order('created_at', { ascending: false })
      .limit(1000),
  ])

  if (stageResult.error) return NextResponse.json({ error: stageResult.error.message }, { status: 500 })
  if (leadsResult.error) return NextResponse.json({ error: leadsResult.error.message }, { status: 500 })

  const defaultStage = stageResult.data
  if (!defaultStage?.id) return NextResponse.json({ error: 'Default CRM stage missing' }, { status: 500 })

  const leads = (leadsResult.data ?? []) as ImportLeadRow[]
  const candidateRows: ImportLeadRow[] = []
  const seenLeadIds = new Set<string>()

  for (const lead of leads) {
    if (lead.id && !seenLeadIds.has(lead.id)) {
      seenLeadIds.add(lead.id)
      candidateRows.push(lead)
    }
  }

  const leadIds = candidateRows.map(lead => lead.id)

  if (mode === 'append' && leadIds.length > 0) {
    const existing = await admin
      .from('cornerstone_crm_people')
      .select('lead_id')
      .in('lead_id', leadIds)

    if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 })

    const existingLeadIds = new Set((existing.data ?? []).map(row => row.lead_id).filter(Boolean))
    const newRows = candidateRows.filter(lead => !existingLeadIds.has(lead.id))
    if (newRows.length === 0) {
      return NextResponse.json({
        inserted: 0,
        updated: 0,
        skipped: leadIds.length,
        stageName: defaultStage.name ?? null,
      })
    }

    const mappedRows = newRows.map(row => ({
      source_system: 'lead',
      lead_id: row.id,
      cornerstone_matter_id: row.matter_id,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      phone: row.phone,
      city: row.city,
      state: row.state,
      country: row.country,
      lead_source: row.lead_source,
      referral_source: row.referral_source,
      lifecycle_status: mapLifecycle(row.lead_status),
      owner_user_id: row.user_id,
      assigned_to_user_id: row.user_id,
      sync_state: 'pending',
      stage_id: defaultStage.id,
      stage_entered_at: new Date().toISOString(),
    }))

    const { error } = await admin.from('cornerstone_crm_people').insert(mappedRows)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      inserted: mappedRows.length,
      updated: 0,
      skipped: existingLeadIds.size,
      stageName: defaultStage.name ?? null,
    })
  }

  const mappedRows = candidateRows.map(row => ({
    source_system: 'lead',
    lead_id: row.id,
    cornerstone_matter_id: row.matter_id,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    phone: row.phone,
    city: row.city,
    state: row.state,
    country: row.country,
    lead_source: row.lead_source,
    referral_source: row.referral_source,
    lifecycle_status: mapLifecycle(row.lead_status),
    owner_user_id: row.user_id,
    assigned_to_user_id: row.user_id,
    sync_state: 'pending',
    stage_id: defaultStage.id,
    stage_entered_at: new Date().toISOString(),
  }))

  const { error } = await admin
    .from('cornerstone_crm_people')
    .upsert(mappedRows, { onConflict: 'lead_id' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    inserted: mappedRows.length,
    updated: mappedRows.length,
    skipped: 0,
    stageName: defaultStage.name ?? null,
  })
}
