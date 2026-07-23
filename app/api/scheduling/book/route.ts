import { NextResponse } from 'next/server'
import {
  AvailabilityUnavailableError,
  bookAppointment,
  SlotTakenError,
} from '@/lib/appointments/book'
import { guardPublicSchedulingRoute } from '@/lib/appointments/publicRouteGuard'
import { getAppointmentTypeByKey } from '@/lib/appointments/settings'
import { isAppointmentLocationType } from '@/lib/appointments/types'
import { getCachedClaims } from '@/lib/supabaseServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface BookBody {
  typeKey?: unknown
  startTime?: unknown
  name?: unknown
  email?: unknown
  phone?: unknown
  notes?: unknown
  locationType?: unknown
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}

export async function POST(req: Request) {
  const limited = await guardPublicSchedulingRoute(req, 'scheduling_book', 5)
  if (limited) return limited

  const body = (await req.json().catch(() => ({}))) as BookBody

  const typeKey = str(body.typeKey, 60)
  const startTime = str(body.startTime, 40)
  const name = str(body.name, 120)
  const emailRaw = str(body.email, 200)
  const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 40) || null : null
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) || null : null

  if (!typeKey || !startTime || !name || !emailRaw) {
    return NextResponse.json(
      { error: 'typeKey, startTime, name, and email are required' },
      { status: 400 },
    )
  }
  if (!EMAIL_RE.test(emailRaw)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  const type = await getAppointmentTypeByKey(typeKey)
  if (!type || !type.active) {
    return NextResponse.json({ error: 'Unknown appointment type' }, { status: 404 })
  }

  const claims = await getCachedClaims()
  if (!type.public && !claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (
    body.locationType !== undefined &&
    !(isAppointmentLocationType(body.locationType) && type.locationTypes.includes(body.locationType))
  ) {
    return NextResponse.json(
      { error: 'That meeting format is not offered for this appointment type' },
      { status: 400 },
    )
  }

  // Signed-in bookings are attributed to the session; the session email is
  // authoritative so a portal client can't book on someone else's behalf.
  const email = claims?.email ?? emailRaw

  try {
    const result = await bookAppointment({
      type,
      startIso: startTime,
      attendeeName: name,
      attendeeEmail: email,
      attendeePhone: phone,
      notes,
      locationType: isAppointmentLocationType(body.locationType) ? body.locationType : null,
      source: claims ? 'portal' : 'public',
      bookedByUserId: claims?.id ?? null,
    })
    return NextResponse.json({
      ok: true,
      appointmentId: result.appointmentId,
      startTime: result.startIso,
      endTime: result.endIso,
      manageToken: result.manageToken,
    })
  } catch (err) {
    if (err instanceof SlotTakenError) {
      return NextResponse.json({ error: err.message, code: 'slot_taken' }, { status: 409 })
    }
    if (err instanceof AvailabilityUnavailableError) {
      return NextResponse.json(
        { error: 'Scheduling is temporarily unavailable. Please try again later.' },
        { status: 503 },
      )
    }
    console.error('[appointments] booking failed', err)
    return NextResponse.json({ error: 'Booking failed. Please try again.' }, { status: 500 })
  }
}
