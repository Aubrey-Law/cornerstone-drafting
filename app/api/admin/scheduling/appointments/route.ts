import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { listAppointmentTypes } from '@/lib/appointments/settings'
import type { AppointmentRow } from '@/lib/appointments/types'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const scope = req.nextUrl.searchParams.get('scope') === 'past' ? 'past' : 'upcoming'
  const nowIso = new Date().toISOString()

  let query = getAdminClient()
    .from('appointments')
    .select(
      'id, appointment_type_id, start_time, end_time, status, attendee_name, attendee_email, attendee_phone, notes, linked_lead_id, linked_matter_id, microsoft_event_id, source, created_at',
    )
    .limit(100)

  query =
    scope === 'past'
      ? query.lt('start_time', nowIso).order('start_time', { ascending: false })
      : query.gte('start_time', nowIso).order('start_time', { ascending: true })

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const types = await listAppointmentTypes()
  const typeById = new Map(types.map(t => [t.id, t]))

  return NextResponse.json({
    appointments: ((data ?? []) as Partial<AppointmentRow>[]).map(row => ({
      id: row.id,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      attendeeName: row.attendee_name,
      attendeeEmail: row.attendee_email,
      attendeePhone: row.attendee_phone,
      notes: row.notes,
      linkedLeadId: row.linked_lead_id,
      linkedMatterId: row.linked_matter_id,
      source: row.source,
      typeLabel: typeById.get(row.appointment_type_id ?? '')?.label ?? 'Unknown',
      // Null after a successful booking means the Outlook event failed to
      // create — surfaced in the admin list as a warning.
      outlookSynced: Boolean(row.microsoft_event_id),
    })),
  })
}
