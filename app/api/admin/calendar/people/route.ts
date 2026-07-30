import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  const raw = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (raw.length < 2) return NextResponse.json({ people: [] })
  const q = raw.replace(/[%,()]/g, ' ').slice(0, 80)
  const admin = getAdminClient()
  const [matters, leads] = await Promise.all([
    admin
      .from('v_matter_pipeline')
      .select('matter_id, client_name, client_email, client_phone, spouse_name, spouse_email')
      .or(`client_name.ilike.%${q}%,client_email.ilike.%${q}%,matter_name.ilike.%${q}%`)
      .limit(6),
    admin
      .from('client_intake')
      .select('id, full_name, first_name, last_name, email, phone')
      .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
      .limit(6),
  ])
  const seen = new Set<string>()
  const people = [
    ...(matters.data ?? []).map(row => ({
      id: `matter:${row.matter_id}`,
      kind: 'matter',
      recordId: row.matter_id,
      name: row.client_name,
      email: row.client_email,
      phone: row.client_phone,
      secondName: row.spouse_name,
      secondEmail: row.spouse_email,
    })),
    ...(leads.data ?? []).map(row => ({
      id: `lead:${row.id}`,
      kind: 'lead',
      recordId: row.id,
      name: row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' '),
      email: row.email,
      phone: row.phone,
      secondName: null,
      secondEmail: null,
    })),
  ].filter(person => {
    const key = String(person.email ?? '').toLowerCase()
    if (key && seen.has(key)) return false
    if (key) seen.add(key)
    return true
  })
  return NextResponse.json({ people })
}
