import { NextResponse } from 'next/server'
import {
  AvailabilityUnavailableError,
  cancelAppointment,
  rescheduleAppointment,
  SlotTakenError,
} from '@/lib/appointments/book'
import { hashManageToken, isManageTokenExpired } from '@/lib/appointments/manageTokens'
import { guardPublicSchedulingRoute } from '@/lib/appointments/publicRouteGuard'
import { listAppointmentTypes } from '@/lib/appointments/settings'
import { resolveLocationType, type AppointmentRow } from '@/lib/appointments/types'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Manage a booking via the emailed link. Auth = possession of the unguessable
 * token (stored hashed, expiring) — same pattern as intake invite tokens.
 */
async function loadByToken(token: string): Promise<AppointmentRow | null> {
  if (!token || token.length > 200) return null
  const { data } = await getAdminClient()
    .from('appointments')
    .select('*')
    .eq('manage_token_hash', hashManageToken(token))
    .maybeSingle()
  const row = data as AppointmentRow | null
  if (!row) return null
  if (isManageTokenExpired(row.manage_token_expires_at)) return null
  return row
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = await guardPublicSchedulingRoute(req, 'scheduling_manage', 20)
  if (limited) return limited

  const { token } = await params
  const row = await loadByToken(token)
  if (!row) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  const types = await listAppointmentTypes()
  const type = types.find(t => t.id === row.appointment_type_id) ?? null

  return NextResponse.json({
    appointment: {
      status: row.status,
      startTime: row.start_time,
      endTime: row.end_time,
      attendeeName: row.attendee_name,
      type: type
        ? {
            key: type.key,
            slug: type.slug,
            label: type.label,
            durationMinutes: type.durationMinutes,
            // The format chosen for this booking, not the type default.
            locationType: resolveLocationType(row.location_type, type),
          }
        : null,
    },
  })
}

interface ManageBody {
  action?: unknown
  startTime?: unknown
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const limited = await guardPublicSchedulingRoute(req, 'scheduling_manage', 10)
  if (limited) return limited

  const { token } = await params
  const row = await loadByToken(token)
  if (!row) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  if (row.status !== 'scheduled') {
    return NextResponse.json({ error: 'This booking is no longer active' }, { status: 409 })
  }

  const types = await listAppointmentTypes()
  const type = types.find(t => t.id === row.appointment_type_id)
  if (!type) return NextResponse.json({ error: 'Appointment type missing' }, { status: 500 })

  const body = (await req.json().catch(() => ({}))) as ManageBody

  try {
    if (body.action === 'cancel') {
      await cancelAppointment({ appointment: row, type })
      return NextResponse.json({ ok: true, status: 'cancelled' })
    }

    if (body.action === 'reschedule') {
      const startTime = typeof body.startTime === 'string' ? body.startTime.trim() : ''
      if (!startTime) {
        return NextResponse.json({ error: 'startTime is required' }, { status: 400 })
      }
      const moved = await rescheduleAppointment({
        appointment: row,
        type,
        newStartIso: startTime,
      })
      return NextResponse.json({ ok: true, status: 'scheduled', ...moved })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
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
    console.error('[appointments] manage action failed', err)
    return NextResponse.json({ error: 'Request failed. Please try again.' }, { status: 500 })
  }
}
