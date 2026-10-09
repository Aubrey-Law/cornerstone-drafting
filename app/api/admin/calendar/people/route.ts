import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { loadBookingAttendee } from '@/lib/appointments/bookingAttendee'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err
  // ?leadId= | ?matterId= → one record's client and spouse, names as stored
  // components, to prefill a booking.
  const leadId = req.nextUrl.searchParams.get('leadId')
  const matterId = req.nextUrl.searchParams.get('matterId')
  if (leadId || matterId) {
    const id = leadId ?? matterId ?? ''
    if ((leadId && matterId) || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Pass one valid leadId or matterId' }, { status: 400 })
    }
    const attendee = await loadBookingAttendee(getAdminClient(), leadId ? { leadId: id } : { matterId: id })
    if (!attendee) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ attendee })
  }
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
