import 'server-only'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  createTeamsMeeting,
  deleteTeamsMeeting,
  rescheduleTeamsMeeting,
  type TeamsMeeting,
} from '@/lib/microsoftTeams'
import { attachTeamsMeetingToAppointmentEvent } from './calendarSync'
import type { AppointmentRow, AppointmentType } from './types'

/**
 * Teams meetings on appointments.
 *
 * The meeting is created in Microsoft 365 and its join link is put on the
 * Google event and in the client's emails. The appointment row records the
 * meeting id so a reschedule or cancel can find the meeting again.
 */

export class TeamsMeetingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TeamsMeetingError'
  }
}

export function teamsMeetingSubject(typeLabel: string, attendeeName: string): string {
  return `${typeLabel} — ${attendeeName}`
}

export async function createAppointmentTeamsMeeting(input: {
  typeLabel: string
  attendeeName: string
  startIso: string
  endIso: string
}): Promise<TeamsMeeting> {
  try {
    return await createTeamsMeeting({
      subject: teamsMeetingSubject(input.typeLabel, input.attendeeName),
      startIso: input.startIso,
      endIso: input.endIso,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Teams meeting could not be created'
    throw new TeamsMeetingError(message)
  }
}

/**
 * Add a Teams meeting to an existing appointment.
 *
 * The meeting is created first and the row updated before the Google event is
 * touched, so a calendar failure still leaves the link on the appointment (and
 * in the admin calendar's Join button) rather than creating an orphan meeting
 * nothing points to. The calendar failure is reported to the caller.
 */
export async function addTeamsMeetingToAppointment(
  appointment: AppointmentRow,
  type: AppointmentType,
): Promise<{ joinUrl: string; calendarUpdated: boolean }> {
  if (appointment.online_meeting_provider === 'microsoft_teams' && appointment.online_meeting_url) {
    return { joinUrl: appointment.online_meeting_url, calendarUpdated: true }
  }

  const meeting = await createAppointmentTeamsMeeting({
    typeLabel: type.label,
    attendeeName: appointment.attendee_name,
    startIso: appointment.start_time,
    endIso: appointment.end_time,
  })

  const { error } = await getAdminClient()
    .from('appointments')
    .update({
      online_meeting_url: meeting.joinUrl,
      online_meeting_provider: 'microsoft_teams',
      teams_meeting_id: meeting.id,
    })
    .eq('id', appointment.id)
  if (error) {
    await deleteTeamsMeeting(meeting.id).catch(() => {})
    throw error
  }

  let calendarUpdated = true
  try {
    await attachTeamsMeetingToAppointmentEvent(appointment, meeting.joinUrl)
  } catch (err) {
    calendarUpdated = false
    console.error('[appointments] attaching Teams link to calendar event failed for', appointment.id, err)
  }
  return { joinUrl: meeting.joinUrl, calendarUpdated }
}

/** Keep a Teams meeting's own times in step with a reschedule. Best-effort. */
export async function rescheduleAppointmentTeamsMeeting(
  appointment: Pick<AppointmentRow, 'id' | 'teams_meeting_id'>,
  startIso: string,
  endIso: string,
): Promise<void> {
  if (!appointment.teams_meeting_id) return
  try {
    await rescheduleTeamsMeeting(appointment.teams_meeting_id, startIso, endIso)
  } catch (err) {
    console.error('[appointments] Teams meeting reschedule failed for', appointment.id, err)
  }
}

/** Remove a cancelled appointment's Teams meeting. Best-effort. */
export async function cancelAppointmentTeamsMeeting(
  appointment: Pick<AppointmentRow, 'id' | 'teams_meeting_id'>,
): Promise<void> {
  if (!appointment.teams_meeting_id) return
  try {
    await deleteTeamsMeeting(appointment.teams_meeting_id)
  } catch (err) {
    console.error('[appointments] Teams meeting delete failed for', appointment.id, err)
  }
}
