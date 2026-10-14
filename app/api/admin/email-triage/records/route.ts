import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { sanitizeTerm } from '@/lib/search/globalSearchSources'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface MailDeskRecordHit {
  kind: 'lead' | 'client'
  name: string
  email: string | null
  leadId: string | null
  matterId: string | null
}

const LIMIT = 10

/**
 * GET /api/admin/email-triage/records?q= — leads and hired matters to link a
 * Mail Desk thread to. Matches name or email (unlike Texts recipients, which
 * can drop email-only hits when refining for a phone).
 */
export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const term = sanitizeTerm(req.nextUrl.searchParams.get('q') ?? '')
  if (term.length < 2) return NextResponse.json({ records: [] as MailDeskRecordHit[] })

  const like = `%${term}%`
  const admin = getAdminClient()

  const { data, error } = await admin
    .from('client_intake')
    .select('id, full_name, first_name, last_name, email, matter_id, lead_status')
    .or(`full_name.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`)
    .order('created_at', { ascending: false })
    .limit(LIMIT * 3)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const matterIds = (data ?? []).map(r => r.matter_id).filter((v): v is string => Boolean(v))
  const { data: matters } = matterIds.length
    ? await admin.from('matters').select('id, relationship_status, matter_number').in('id', matterIds)
    : { data: [] as Array<{ id: string; relationship_status: string | null; matter_number: string | null }> }
  const matterById = new Map((matters ?? []).map(m => [m.id, m]))

  const records: MailDeskRecordHit[] = []
  const termLower = term.toLowerCase()
  for (const row of data ?? []) {
    if (!row.lead_status && !row.matter_id) continue
    const name = row.full_name?.trim()
      || [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
      || 'Unnamed'
    const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : null
    const nameHit = name.toLowerCase().includes(termLower)
    const emailHit = Boolean(email && email.includes(termLower))
    if (!nameHit && !emailHit) continue

    const matter = row.matter_id ? matterById.get(row.matter_id) : null
    const hired = matter?.relationship_status === 'hired'
    if (hired && row.matter_id) {
      const label = matter?.matter_number
        ? `${name} · ${matter.matter_number}`
        : name
      records.push({
        kind: 'client',
        name: label,
        email,
        leadId: null,
        matterId: row.matter_id,
      })
    } else {
      records.push({
        kind: 'lead',
        name,
        email,
        leadId: row.id,
        matterId: row.matter_id ?? null,
      })
    }
    if (records.length >= LIMIT) break
  }

  return NextResponse.json({ records })
}
