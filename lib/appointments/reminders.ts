import 'server-only'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { sendEmail } from '@/lib/email/send'
import { loadFirmSettings } from '@/lib/firmSettings'
import { formatWhen, locationLine } from './emailFormat'
import { getSchedulingSettings, listAppointmentTypes } from './settings'
import { getFirmConfig } from '@/lib/firmConfig'
import { normalizeSmsRecipient, sendSmsMessage } from '@/lib/twilio/sms'
import { resolveLocationType, type AppointmentType } from './types'

const HOUR_MS = 3_600_000

interface DueReminderRow {
  id: string
  appointment_type_id: string
  start_time: string
  attendee_name: string
  attendee_email: string
  attendee_phone: string | null
  second_attendee_email: string | null
  online_meeting_url: string | null
  location_type: string | null
  created_at: string
}

export interface SendDueRemindersResult {
  sent: number
  skipped: number
  failed: number
  disabled: boolean
}

/**
 * Send reminder emails for appointments starting within the configured lead
 * time. Idempotent under repeated/concurrent runs: each row is claimed by a
 * conditional update on `reminder_sent_at IS NULL` before sending, and the
 * claim is released if the send fails so the next run retries.
 *
 * Appointments booked inside the reminder window are skipped — the
 * confirmation email just went out and a same-hour reminder is noise.
 */
export async function sendDueReminders(now = new Date()): Promise<SendDueRemindersResult> {
  const settings = await getSchedulingSettings()
  const hours = settings.reminderHoursBefore
  if (!Number.isFinite(hours) || hours <= 0) {
    return { sent: 0, skipped: 0, failed: 0, disabled: true }
  }

  const admin = getAdminClient()
  const cutoffIso = new Date(now.getTime() + hours * HOUR_MS).toISOString()
  const nowIso = now.toISOString()

  const { data, error } = await admin
    .from('appointments')
    .select('id, appointment_type_id, start_time, attendee_name, attendee_email, attendee_phone, second_attendee_email, online_meeting_url, location_type, created_at')
    .eq('status', 'scheduled')
    .is('reminder_sent_at', null)
    .gt('start_time', nowIso)
    .lte('start_time', cutoffIso)
    .order('start_time', { ascending: true })
    .limit(100)
  if (error) throw error

  const due = (data ?? []) as DueReminderRow[]
  if (due.length === 0) return { sent: 0, skipped: 0, failed: 0, disabled: false }

  const [types, firm] = await Promise.all([listAppointmentTypes(), loadFirmSettings()])
  const typeById = new Map(types.map(t => [t.id, t]))
  const office = [firm.street, [firm.city, firm.state].filter(Boolean).join(', '), firm.zip]
    .filter(Boolean)
    .join(', ')

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const row of due) {
    const startMs = Date.parse(row.start_time)
    const bookedInsideWindow = Date.parse(row.created_at) >= startMs - hours * HOUR_MS
    if (bookedInsideWindow || !row.attendee_email) {
      skipped++
      continue
    }

    const type = typeById.get(row.appointment_type_id)

    // Claim before sending; zero rows back means another run owns it.
    const { data: claimed, error: claimError } = await admin
      .from('appointments')
      .update({ reminder_sent_at: nowIso })
      .eq('id', row.id)
      .is('reminder_sent_at', null)
      .select('id')
    if (claimError || !claimed?.length) {
      skipped++
      continue
    }

    const ok = await sendReminderEmail({
      row,
      type: type ?? null,
      office: office || null,
      timezone: settings.timezone,
    })
    if (ok) {
      sent++
      // SMS is additive — an SMS failure never rolls back the email claim.
      if (settings.smsRemindersEnabled) {
        await sendReminderSms(row, type ?? null, settings.timezone)
      }
    } else {
      failed++
      // Release the claim so the next run retries.
      await admin
        .from('appointments')
        .update({ reminder_sent_at: null })
        .eq('id', row.id)
    }
  }

  return { sent, skipped, failed, disabled: false }
}

/** Best-effort SMS nudge alongside the email reminder. */
async function sendReminderSms(
  row: DueReminderRow,
  type: AppointmentType | null,
  timezone: string,
): Promise<void> {
  try {
    const to = normalizeSmsRecipient(row.attendee_phone)
    if (!to) return
    const firm = getFirmConfig()
    const when = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(row.start_time))
    const result = await sendSmsMessage({
      to,
      body: `Reminder from ${firm.firmName}: ${type?.label ?? 'appointment'} on ${when}. Questions? Call ${firm.phone}.`,
    })
    if (!result.ok) {
      console.error('[appointments] reminder SMS failed for', row.id, result.error)
    }
  } catch (err) {
    console.error('[appointments] reminder SMS failed for', row.id, err)
  }
}

async function sendReminderEmail(input: {
  row: DueReminderRow
  type: AppointmentType | null
  office: string | null
  timezone: string
}): Promise<boolean> {
  const { row, type, office, timezone } = input
  const label = type?.label ?? 'Appointment'
  const when = formatWhen(row.start_time, timezone)
  const location = type
    ? locationLine(
        { ...type, locationType: resolveLocationType(row.location_type, type) },
        office,
        row.online_meeting_url,
      )
    : null

  try {
    const result = await sendEmail({
      category: 'appointment_reminder',
      to: row.attendee_email,
      cc: row.second_attendee_email ?? undefined,
      subject: `Reminder: ${label} — ${when}`,
      html: `<div style="font-family:sans-serif;font-size:14px;color:#222">
        <h2 style="margin:0 0 12px">Your upcoming appointment</h2>
        <p><strong>${label}</strong></p>
        <p>${when}</p>
        ${location ? `<p>${location}</p>` : ''}
        <p style="margin-top:16px">Need to make a change? Use the link in your
        confirmation email, or reply to this message and we will help.</p>
      </div>`,
    })
    return result.ok
  } catch (err) {
    console.error('[appointments] reminder email failed for', row.id, err)
    return false
  }
}
