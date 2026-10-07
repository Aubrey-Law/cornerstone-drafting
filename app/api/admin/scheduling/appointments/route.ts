import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import {
  AvailabilityUnavailableError,
  bookAppointment,
  cancelAppointment,
  markNoShow,
  rescheduleAppointment,
  SlotTakenError,
} from '@/lib/appointments/book'
import { isMissingColumnError, listAppointmentTypes } from '@/lib/appointments/settings'
import { BookingNameValidationError, externalSourceLabel, isAppointmentLocationType, normalizeBookingNames, type AppointmentRow } from '@/lib/appointments/types'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  type BookingAnswer,
  BookingAnswerValidationError,
  parseBookingAnswers,
  resolveBookingAnswers,
} from '@/lib/appointments/bookingQuestions'
import { getRawBoolean, getRawString } from '@/lib/appointments/rawMetadata'
import { addTeamsMeetingToAppointment, switchAppointmentToGoogleMeet, TeamsMeetingError } from '@/lib/appointments/teamsMeeting'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const params = req.nextUrl.searchParams
  const from = params.get('from') ? Date.parse(params.get('from')!) : NaN
  const to = params.get('to') ? Date.parse(params.get('to')!) : NaN
  const hasRange = Number.isFinite(from) && Number.isFinite(to) && to > from

  const baseColumns =
    'id, appointment_type_id, start_time, end_time, status, location_type, attendee_name, attendee_email, attendee_phone, second_attendee_name, second_attendee_email, notes, linked_lead_id, linked_matter_id, google_event_id, online_meeting_url, online_meeting_provider, source, created_at, raw'
  const run = (columns: string) => {
    const query = getAdminClient().from('appointments').select(columns)
    if (hasRange) {
      // Calendar mode: every appointment intersecting [from, to), including overnight meetings.
      return query
        .lt('start_time', new Date(to).toISOString())
        .gt('end_time', new Date(from).toISOString())
        .order('start_time', { ascending: true })
        .limit(500)
    }
    const scope = params.get('scope') === 'past' ? 'past' : 'upcoming'
    const nowIso = new Date().toISOString()
    return (
      scope === 'past'
        ? query.lt('start_time', nowIso).order('start_time', { ascending: false })
        : query.gte('start_time', nowIso).order('start_time', { ascending: true })
    ).limit(100)
  }

  let { data, error } = await run(`${baseColumns}, booking_answers`)
  // Until the booking_answers migration lands, read without it.
  if (error && isMissingColumnError(error)) ({ data, error } = await run(baseColumns))
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const types = await listAppointmentTypes()
  const typeById = new Map(types.map(t => [t.id, t]))

  // Matter numbers for the chip shown on calendar events.
  const rows = (data ?? []) as unknown as (AppointmentRow & { raw?: unknown; booking_answers?: unknown })[]

  const linkedMatterIds = Array.from(
    new Set(rows.map(row => row.linked_matter_id).filter((id): id is string => Boolean(id))),
  )
  const matterNumberById = new Map<string, string>()
  const matterContextById = new Map<string, { stage: string | null; planType: string | null }>()
  if (linkedMatterIds.length > 0) {
    const [linkedMattersResult, pipelineResult] = await Promise.all([
      getAdminClient().from('matters').select('id, matter_number').in('id', linkedMatterIds),
      getAdminClient()
        .from('v_matter_pipeline')
        .select('matter_id, stage, plan_type')
        .in('matter_id', linkedMatterIds),
    ])
    const linkedMatters = linkedMattersResult.data
    for (const row of linkedMatters ?? []) {
      if (row.matter_number) matterNumberById.set(row.id, row.matter_number)
    }
    for (const row of pipelineResult.data ?? []) {
      matterContextById.set(row.matter_id, { stage: row.stage, planType: row.plan_type })
    }
  }

  return NextResponse.json({
    types: types.map(t => ({
      id: t.id,
      label: t.label,
      durationMinutes: t.durationMinutes,
      locationType: t.locationType,
      locationTypes: t.locationTypes,
      active: t.active,
    })),
    appointments: rows.map(row => ({
      id: row.id,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      locationType: row.location_type ?? null,
      secondAttendeeName: row.second_attendee_name ?? null,
      secondAttendeeEmail: row.second_attendee_email ?? null,
      attendeeName: row.attendee_name,
      attendeeEmail: row.attendee_email,
      attendeePhone: row.attendee_phone,
      notes: row.notes,
      bookingAnswers: parseBookingAnswers(row.booking_answers),
      linkedLeadId: row.linked_lead_id,
      linkedMatterId: row.linked_matter_id,
      linkedMatterNumber: row.linked_matter_id
        ? matterNumberById.get(row.linked_matter_id) ?? null
        : null,
      linkedMatterStage: row.linked_matter_id
        ? matterContextById.get(row.linked_matter_id)?.stage ?? null
        : null,
      linkedMatterPlanType: row.linked_matter_id
        ? matterContextById.get(row.linked_matter_id)?.planType ?? null
        : null,
      source: row.source,
      typeLabel:
        getRawString(row.raw, 'taskTypeLabel') ??
        typeById.get(row.appointment_type_id ?? '')?.label ??
        'Unknown',
      calendarShowAsBusy: getRawBoolean(row.raw, 'calendarShowAsBusy', true),
      // Null after a successful booking means the calendar event failed to
      // create — surfaced in the admin list as a warning. Either provider
      // counts: the warning is about the appointment not reaching a calendar,
      // not about which calendar it was.
      calendarSynced: Boolean(row.google_event_id),
      onlineMeetingUrl: row.online_meeting_url ?? null,
      onlineMeetingProvider: row.online_meeting_provider ?? null,
    })),
  })
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface PostBody {
  typeId?: unknown
  startIso?: unknown
  attendeeFirstName?: unknown
  attendeeLastName?: unknown
  attendeeEmail?: unknown
  attendeePhone?: unknown
  notes?: unknown
  locationType?: unknown
  secondAttendeeFirstName?: unknown
  secondAttendeeLastName?: unknown
  secondAttendeeEmail?: unknown
  videoProvider?: unknown
  /** `{ [questionId]: answer }`; required questions are not enforced for staff. */
  answers?: unknown
}

/**
 * Staff books an appointment on a client's behalf from the admin calendar.
 * Bypasses client-facing rules (weekly hours, notice, horizon, buffer) but
 * still rejects hard conflicts with calendar busy times and other bookings.
 */
export async function POST(req: NextRequest) {
  const { err, userId } = await requireAdmin(req)
  if (err) return err

  const body = (await req.json().catch(() => ({}))) as PostBody
  const typeId = typeof body.typeId === 'string' ? body.typeId : ''
  const startIso = typeof body.startIso === 'string' ? body.startIso : ''
  let names: ReturnType<typeof normalizeBookingNames>
  try {
    names = normalizeBookingNames({ ...body, firstName: body.attendeeFirstName, lastName: body.attendeeLastName })
  } catch (error) {
    if (error instanceof BookingNameValidationError) return NextResponse.json({ error: error.message }, { status: 400 })
    throw error
  }
  const attendeeEmail =
    typeof body.attendeeEmail === 'string' ? body.attendeeEmail.trim().toLowerCase() : ''
  const attendeePhone =
    typeof body.attendeePhone === 'string' ? body.attendeePhone.trim().slice(0, 40) : null
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : null
  const secondAttendeeEmail =
    typeof body.secondAttendeeEmail === 'string' ? body.secondAttendeeEmail.trim().toLowerCase() : null

  if (secondAttendeeEmail && !EMAIL_RE.test(secondAttendeeEmail)) {
    return NextResponse.json({ error: 'Invalid second attendee email' }, { status: 400 })
  }

  if (!typeId || !startIso || !EMAIL_RE.test(attendeeEmail)) {
    return NextResponse.json(
      { error: 'typeId, startIso, and a valid attendeeEmail are required' },
      { status: 400 },
    )
  }
  if (!Number.isFinite(Date.parse(startIso))) {
    return NextResponse.json({ error: 'Invalid start time' }, { status: 400 })
  }

  const type = (await listAppointmentTypes()).find(t => t.id === typeId)
  if (!type) return NextResponse.json({ error: 'Unknown appointment type' }, { status: 404 })

  if (
    body.locationType !== undefined &&
    !(isAppointmentLocationType(body.locationType) && type.locationTypes.includes(body.locationType))
  ) {
    return NextResponse.json(
      { error: 'That meeting format is not offered for this appointment type' },
      { status: 400 },
    )
  }

  let bookingAnswers: BookingAnswer[]
  try {
    bookingAnswers = resolveBookingAnswers(type.bookingQuestions, body.answers, { enforceRequired: false })
  } catch (error) {
    if (error instanceof BookingAnswerValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }

  try {
    const result = await bookAppointment({
      type,
      startIso,
      ...names,
      attendeeEmail,
      attendeePhone: attendeePhone || null,
      notes,
      bookingAnswers,
      locationType: isAppointmentLocationType(body.locationType) ? body.locationType : null,
      secondAttendeeEmail: secondAttendeeEmail || null,
      source: 'admin',
      bookedByUserId: userId ?? null,
      videoProvider: body.videoProvider === 'microsoft_teams' ? 'microsoft_teams' : null,
    })
    return NextResponse.json({
      ok: true,
      appointmentId: result.appointmentId,
      startIso: result.startIso,
      endIso: result.endIso,
      ...(result.teamsMeetingError ? { teamsMeetingError: result.teamsMeetingError } : {}),
    })
  } catch (e) {
    if (e instanceof SlotTakenError) {
      return NextResponse.json(
        { error: 'That time conflicts with the calendar or another appointment.' },
        { status: 409 },
      )
    }
    if (e instanceof AvailabilityUnavailableError) {
      return NextResponse.json(
        { error: 'Google Calendar is unreachable — cannot verify the time is free. Try again shortly.' },
        { status: 503 },
      )
    }
    throw e
  }
}

interface PatchBody {
  appointmentId?: unknown
  action?: unknown
  newStartIso?: unknown
  sendFollowUp?: unknown
}

const PATCH_ACTIONS = ['cancel', 'reschedule', 'no_show', 'add_teams_meeting', 'use_google_meet'] as const
type PatchAction = (typeof PATCH_ACTIONS)[number]

function isPatchAction(value: unknown): value is PatchAction {
  return typeof value === 'string' && (PATCH_ACTIONS as readonly string[]).includes(value)
}

/**
 * Staff manages an existing appointment from the admin calendar:
 * cancel (client notified), reschedule (admin override — hard conflicts
 * only), mark a past appointment as a no-show (optional follow-up email), or
 * add a Microsoft Teams meeting (the updated invite goes to attendees).
 */
export async function PATCH(req: NextRequest) {
  const { err } = await requireAdmin(req)
  if (err) return err

  const body = (await req.json().catch(() => ({}))) as PatchBody
  const appointmentId = typeof body.appointmentId === 'string' ? body.appointmentId : ''
  const action = body.action
  if (!appointmentId || !isPatchAction(action)) {
    return NextResponse.json(
      { error: 'appointmentId and a valid action (cancel | reschedule | no_show | add_teams_meeting | use_google_meet) are required' },
      { status: 400 },
    )
  }

  const { data, error } = await getAdminClient()
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const appointment = data as AppointmentRow | null
  if (!appointment) return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
  const externalLabel = externalSourceLabel(appointment.source)
  if (externalLabel) {
    return NextResponse.json(
      { error: `This appointment is managed in ${externalLabel}. Reschedule or cancel it there.` },
      { status: 409 },
    )
  }

  const type = (await listAppointmentTypes()).find(t => t.id === appointment.appointment_type_id)
  if (!type) return NextResponse.json({ error: 'Unknown appointment type' }, { status: 404 })

  try {
    if (action === 'cancel') {
      if (appointment.status !== 'scheduled') {
        return NextResponse.json({ error: 'Only scheduled appointments can be cancelled' }, { status: 409 })
      }
      await cancelAppointment({ appointment, type, cancelledByStaff: true })
      return NextResponse.json({ ok: true, status: 'cancelled' })
    }

    if (action === 'no_show') {
      if (appointment.status !== 'scheduled') {
        return NextResponse.json({ error: 'Only scheduled appointments can be marked no-show' }, { status: 409 })
      }
      if (Date.parse(appointment.start_time) > Date.now()) {
        return NextResponse.json({ error: 'Cannot mark a future appointment as a no-show' }, { status: 409 })
      }
      await markNoShow({ appointment, type, sendFollowUp: body.sendFollowUp !== false })
      return NextResponse.json({ ok: true, status: 'no_show' })
    }

    if (action === 'add_teams_meeting') {
      if (appointment.status !== 'scheduled') {
        return NextResponse.json({ error: 'Only scheduled appointments can get a Teams meeting' }, { status: 409 })
      }
      if (Date.parse(appointment.end_time) < Date.now()) {
        return NextResponse.json({ error: 'This appointment has already ended' }, { status: 409 })
      }
      try {
        const result = await addTeamsMeetingToAppointment(appointment, type)
        return NextResponse.json({
          ok: true,
          status: appointment.status,
          onlineMeetingUrl: result.joinUrl,
          onlineMeetingProvider: 'microsoft_teams',
          calendarUpdated: result.calendarUpdated,
        })
      } catch (e) {
        if (e instanceof TeamsMeetingError) {
          const notConnected = /not connected/i.test(e.message)
          return NextResponse.json(
            {
              error: notConnected
                ? 'Microsoft Teams is not connected. Connect it under Settings → Google & Teams.'
                : e.message,
            },
            { status: notConnected ? 409 : 502 },
          )
        }
        throw e
      }
    }

    if (action === 'use_google_meet') {
      if (appointment.status !== 'scheduled') {
        return NextResponse.json({ error: 'Only scheduled appointments can get a Google Meet' }, { status: 409 })
      }
      if (Date.parse(appointment.end_time) < Date.now()) {
        return NextResponse.json({ error: 'This appointment has already ended' }, { status: 409 })
      }
      try {
        const result = await switchAppointmentToGoogleMeet(appointment)
        return NextResponse.json({
          ok: true,
          status: appointment.status,
          onlineMeetingUrl: result.joinUrl,
          onlineMeetingProvider: 'google_meet',
          calendarUpdated: true,
        })
      } catch (e) {
        if (e instanceof TeamsMeetingError) return NextResponse.json({ error: e.message }, { status: 409 })
        console.error('[appointments] switching to Google Meet failed', e)
        return NextResponse.json({ error: 'Could not add a Google Meet. Check the Google Calendar connection.' }, { status: 502 })
      }
    }

    // action === 'reschedule'
    const newStartIso = typeof body.newStartIso === 'string' ? body.newStartIso : ''
    if (!Number.isFinite(Date.parse(newStartIso))) {
      return NextResponse.json({ error: 'newStartIso is required to reschedule' }, { status: 400 })
    }
    if (appointment.status !== 'scheduled') {
      return NextResponse.json({ error: 'Only scheduled appointments can be rescheduled' }, { status: 409 })
    }
    const result = await rescheduleAppointment({
      appointment,
      type,
      newStartIso,
      adminOverride: true,
    })
    return NextResponse.json({ ok: true, status: 'scheduled', ...result })
  } catch (e) {
    if (e instanceof SlotTakenError) {
      return NextResponse.json(
        { error: 'That time conflicts with the calendar or another appointment.' },
        { status: 409 },
      )
    }
    if (e instanceof AvailabilityUnavailableError) {
      return NextResponse.json(
        { error: 'Google Calendar is unreachable — cannot verify the time is free. Try again shortly.' },
        { status: 503 },
      )
    }
    throw e
  }
}
