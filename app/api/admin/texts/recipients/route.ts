import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { sanitizeTerm } from '@/lib/search/globalSearchSources'
import { optOutPhoneKey } from '@/lib/sms/optOut'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export interface TextRecipient {
  kind: 'lead' | 'client' | 'contact'
  name: string
  /** 10-digit key, or null when the record has no textable number. */
  phone: string | null
  leadId: string | null
  matterId: string | null
  contactId: string | null
}

const LIMIT = 8

/**
 * GET /api/admin/texts/recipients?q= — leads, clients and contacts to start a
 * text with or link a conversation to. Matches name or email, or the last
 * four digits of a phone number when the query has digits.
 */
export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const term = sanitizeTerm(req.nextUrl.searchParams.get('q') ?? '')
  if (term.length < 2) return NextResponse.json({ recipients: [] })

  const digits = term.replace(/\D/g, '')
  const like = `%${term}%`
  const phoneLike = digits.length >= 4 ? `,phone.ilike.%${digits.slice(-4)}%` : ''
  const admin = getAdminClient()

  const [intakes, contacts] = await Promise.all([
    admin
      .from('client_intake')
      .select('id, full_name, first_name, last_name, email, phone, matter_id, lead_status')
      .or(`full_name.ilike.${like},first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}${phoneLike}`)
      .order('created_at', { ascending: false })
      .limit(LIMIT * 2),
    admin
      .from('contacts')
      .select('id, first_name, last_name, preferred_name, email, phone')
      .is('merged_into_id', null)
      .or(`first_name.ilike.${like},last_name.ilike.${like},preferred_name.ilike.${like},email.ilike.${like}${phoneLike}`)
      .limit(LIMIT),
  ])
  if (intakes.error || contacts.error) {
    return NextResponse.json(
      { error: intakes.error?.message ?? contacts.error?.message },
      { status: 500 },
    )
  }

  const matterIds = (intakes.data ?? []).map(r => r.matter_id).filter((v): v is string => Boolean(v))
  const { data: matters } = matterIds.length
    ? await admin.from('matters').select('id, relationship_status').in('id', matterIds)
    : { data: [] as Array<{ id: string; relationship_status: string | null }> }
  const statusById = new Map((matters ?? []).map(m => [m.id, m.relationship_status ?? 'hired']))

  const termLower = term.toLowerCase()
  const phoneMatches = (phone: string | null) =>
    digits.length < 4 || (optOutPhoneKey(phone) ?? '').includes(digits.slice(-10))

  const recipients: TextRecipient[] = []
  for (const row of intakes.data ?? []) {
    if (!row.lead_status && !row.matter_id) continue
    const name = row.full_name?.trim() || [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
    const email = typeof row.email === 'string' ? row.email.toLowerCase() : ''
    const nameHit = name.toLowerCase().includes(termLower)
    const emailHit = Boolean(email && email.includes(termLower))
    // Keep email-only hits: the OR query already matched email, and dropping
    // them here made "link by email" useless for Texts and Mail Desk.
    if (!nameHit && !emailHit && !phoneMatches(row.phone)) continue
    const hired = row.matter_id && statusById.get(row.matter_id) === 'hired'
    recipients.push({
      kind: hired ? 'client' : 'lead',
      name: name || 'Unnamed',
      phone: optOutPhoneKey(row.phone),
      leadId: hired ? null : row.id,
      matterId: row.matter_id ?? null,
      contactId: null,
    })
  }
  for (const row of contacts.data ?? []) {
    const name = [row.preferred_name?.trim() || row.first_name?.trim(), row.last_name?.trim()]
      .filter(Boolean)
      .join(' ')
    const email = typeof row.email === 'string' ? row.email.toLowerCase() : ''
    const nameHit = name.toLowerCase().includes(termLower)
    const emailHit = Boolean(email && email.includes(termLower))
    if (!nameHit && !emailHit && !phoneMatches(row.phone)) continue
    recipients.push({
      kind: 'contact',
      name: name || 'Unnamed contact',
      phone: optOutPhoneKey(row.phone),
      leadId: null,
      matterId: null,
      contactId: row.id,
    })
  }

  return NextResponse.json({ recipients: recipients.slice(0, LIMIT * 2) })
}
