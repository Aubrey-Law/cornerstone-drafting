import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { formatPhoneForStorage } from '@/lib/phone'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function cleanString(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

/**
 * POST /api/admin/contacts — add a person to the firm contact book.
 *
 * Standalone by default (client_intake_id null); pass client_intake_id to
 * attach the contact to an existing lead or client household.
 */
export async function POST(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const payload = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!payload) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const firstName = cleanString(payload.first_name)
  const lastName = cleanString(payload.last_name)
  if (!firstName && !lastName) {
    return NextResponse.json({ error: 'A first or last name is required' }, { status: 400 })
  }

  const email = cleanString(payload.email)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
  }

  const admin = getAdminClient()

  const intakeId = cleanString(payload.client_intake_id, 64)
  if (intakeId) {
    const { data: intake, error: intakeError } = await admin
      .from('client_intake')
      .select('id')
      .eq('id', intakeId)
      .maybeSingle()
    if (intakeError) return NextResponse.json({ error: intakeError.message }, { status: 500 })
    if (!intake) return NextResponse.json({ error: 'Related person not found' }, { status: 404 })
  }

  const { data, error } = await admin
    .from('contacts')
    .insert({
      client_intake_id: intakeId,
      relationship_type: 'other',
      relationship_label: cleanString(payload.relationship_label, 120),
      first_name: firstName,
      last_name: lastName,
      email: email?.toLowerCase() ?? null,
      phone: formatPhoneForStorage(cleanString(payload.phone, 40)),
      city: cleanString(payload.city, 120),
      state: cleanString(payload.state, 40),
      source: 'directory',
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, contactId: data.id })
}
