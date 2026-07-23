import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  AvailabilityUnavailableError,
  bookAppointment,
  SlotTakenError,
} from '@/lib/appointments/book'
import { listAppointmentTypes } from '@/lib/appointments/settings'
import type { AppointmentRow } from '@/lib/appointments/types'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const params = req.nextUrl.searchParams
  const from = params.get('from') ? Date.parse(params.get('from')!) : NaN
  const to = params.get('to') ? Date.parse(params.get('to')!) : NaN
  const hasRange = Number.isFinite(from) && Number.isFinite(to) && to > from

  let query = getAdminClient()
    .from('appointments')
    .select(
      'id, appointment_type_id, start_time, end_time, status, attendee_name, attendee_email, attendee_phone, notes, linked_lead_id, linked_matter_id, microsoft_event_id, source, created_at',
    )

  if (hasRange) {
    // Calendar mode: everything in [from, to), oldest first.
    query = query
      .gte('start_time', new Date(from).toISOString())
      .lt('start_time', new Date(to).toISOString())
      .order('start_time', { ascending: true })
      .limit(500)
  } else {
    const scope = params.get('scope') === 'past' ? 'past' : 'upcoming'
    const nowIso = new Date().toISOString()
    query = (
      scope === 'past'
        ? query.lt('start_time', nowIso).order('start_time', { ascending: false })
        : query.gte('start_time', nowIso).order('start_time', { ascending: true })
    ).limit(100)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const types = await listAppointmentTypes()
  const typeById = new Map(types.map(t => [t.id, t]))

  return NextResponse.json({
    types: types.map(t => ({
      id: t.id,
      label: t.label,
      durationMinutes: t.durationMinutes,
      locationType: t.locationType,
      active: t.active,
    })),
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface PostBody {
  typeId?: unknown
  startIso?: unknown
  attendeeName?: unknown
  attendeeEmail?: unknown
  attendeePhone?: unknown
  notes?: unknown
}

/**
 * Staff books an appointment on a client's behalf from the admin calendar.
 * Bypasses client-facing rules (weekly hours, notice, horizon, buffer) but
 * still rejects hard conflicts with Outlook busy times and other bookings.
 */
export async function POST(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = (await req.json().catch(() => ({}))) as PostBody
  const typeId = typeof body.typeId === 'string' ? body.typeId : ''
  const startIso = typeof body.startIso === 'string' ? body.startIso : ''
  const attendeeName = typeof body.attendeeName === 'string' ? body.attendeeName.trim().slice(0, 200) : ''
  const attendeeEmail =
    typeof body.attendeeEmail === 'string' ? body.attendeeEmail.trim().toLowerCase() : ''
  const attendeePhone =
    typeof body.attendeePhone === 'string' ? body.attendeePhone.trim().slice(0, 40) : null
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : null

  if (!typeId || !startIso || !attendeeName || !EMAIL_RE.test(attendeeEmail)) {
    return NextResponse.json(
      { error: 'typeId, startIso, attendeeName, and a valid attendeeEmail are required' },
      { status: 400 },
    )
  }
  if (!Number.isFinite(Date.parse(startIso))) {
    return NextResponse.json({ error: 'Invalid start time' }, { status: 400 })
  }

  const type = (await listAppointmentTypes()).find(t => t.id === typeId)
  if (!type) return NextResponse.json({ error: 'Unknown appointment type' }, { status: 404 })

  try {
    const result = await bookAppointment({
      type,
      startIso,
      attendeeName,
      attendeeEmail,
      attendeePhone: attendeePhone || null,
      notes,
      source: 'admin',
      bookedByUserId: userId ?? null,
    })
    return NextResponse.json({
      ok: true,
      appointmentId: result.appointmentId,
      startIso: result.startIso,
      endIso: result.endIso,
    })
  } catch (e) {
    if (e instanceof SlotTakenError) {
      return NextResponse.json(
        { error: 'That time conflicts with the Outlook calendar or another appointment.' },
        { status: 409 },
      )
    }
    if (e instanceof AvailabilityUnavailableError) {
      return NextResponse.json(
        { error: 'Outlook is unreachable — cannot verify the time is free. Try again shortly.' },
        { status: 503 },
      )
    }
    throw e
  }
}
