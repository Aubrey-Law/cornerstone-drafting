import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface DirectoryEntry {
  digits: string
  name: string
  matterId: string | null
  matterNumber: string | null
  leadId: string | null
  practiceArea: string | null
  stage: string | null
}

const last10 = (value: unknown): string | null => {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : ''
  return digits.length >= 10 ? digits.slice(-10) : null
}

/**
 * GET /api/admin/phone/directory
 *
 * Every phone number the firm might dial or receive, mapped to its matter or
 * lead. Consumed by the softphone to name callers and link calls to matters.
 */
export async function GET(req: Request) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const admin = getAdminClient()

  const [pipeline, matterNumbers, leads] = await Promise.all([
    admin
      .from('v_matter_pipeline')
      .select('matter_id, client_name, client_phone, spouse_name, spouse_phone, practice_area, stage'),
    admin.from('matters').select('id, matter_number').neq('status', 'archived'),
    admin
      .from('client_intake')
      .select('id, first_name, last_name, full_name, phone, lead_status')
      .is('matter_id', null)
      .or('lead_status.is.null,lead_status.neq.lost'),
  ])

  if (pipeline.error) return NextResponse.json({ error: pipeline.error.message }, { status: 500 })
  if (matterNumbers.error) return NextResponse.json({ error: matterNumbers.error.message }, { status: 500 })
  if (leads.error) return NextResponse.json({ error: leads.error.message }, { status: 500 })

  const numberByMatter = new Map<string, string | null>(
    (matterNumbers.data ?? []).map(m => [m.id as string, (m.matter_number as string | null) ?? null]),
  )

  const seen = new Set<string>()
  const entries: DirectoryEntry[] = []

  const push = (entry: DirectoryEntry) => {
    if (seen.has(entry.digits)) return
    seen.add(entry.digits)
    entries.push(entry)
  }

  for (const m of pipeline.data ?? []) {
    const base = {
      matterId: m.matter_id as string,
      matterNumber: numberByMatter.get(m.matter_id as string) ?? null,
      leadId: null,
      practiceArea: (m.practice_area as string | null) ?? null,
      stage: (m.stage as string | null) ?? null,
    }
    const client = last10(m.client_phone)
    if (client) push({ ...base, digits: client, name: (m.client_name as string | null)?.trim() || 'Client' })
    const spouse = last10(m.spouse_phone)
    if (spouse) push({ ...base, digits: spouse, name: (m.spouse_name as string | null)?.trim() || 'Spouse' })
  }

  // Leads come second so an active matter always wins a shared number.
  for (const l of leads.data ?? []) {
    const digits = last10(l.phone)
    if (!digits) continue
    const name =
      (l.full_name as string | null)?.trim() ||
      `${(l.first_name as string | null) ?? ''} ${(l.last_name as string | null) ?? ''}`.trim() ||
      'Lead'
    push({
      digits,
      name,
      matterId: null,
      matterNumber: null,
      leadId: l.id as string,
      practiceArea: null,
      stage: 'Lead',
    })
  }

  return NextResponse.json({ entries }, { headers: { 'Cache-Control': 'private, max-age=60' } })
}
