import 'server-only'
import { sendEmail } from '@/lib/email/send'
import { getFirmConfig } from '@/lib/firmConfig'
import { ensureStandingIntakeLink } from '@/lib/intake/standingLinks'
import { fireEngineStageTask } from '@/lib/stage-engine/fireStageTasks'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { stageLabel, type MatterStage } from '@/types/database'
import type { AppointmentType } from './types'

/**
 * Post-booking automation, fired after a booking is committed. Every step is
 * best-effort: a failure here never fails the booking.
 */
export interface AfterBookedInput {
  type: AppointmentType
  leadId: string | null
  matterId: string | null
  /** Auto-send the intake invite for lead discovery calls (settings toggle). */
  autoIntakeInvite: boolean
  /** When the appointment starts; the signing-day kit is keyed to the day. */
  startIso?: string | null
  /** The staff member who booked, when a person did; the kit proposal is theirs. */
  bookedByUserId?: string | null
}

export async function runPostBookingAutomation(input: AfterBookedInput): Promise<void> {
  try {
    if (input.type.key === 'discovery_call' && input.autoIntakeInvite && input.leadId) {
      await maybeSendIntakeInvite(input.leadId)
    }
  } catch (err) {
    console.error('[appointments] intake invite automation failed', err)
  }

  try {
    if (input.matterId) {
      await maybeAdvanceStage(input.matterId, input.type)
    }
  } catch (err) {
    console.error('[appointments] stage automation failed', err)
  }

  // A signing on the calendar is the moment the kit becomes work: the dial
  // decides whether the record is opened and the print task created unasked.
  try {
    if (input.matterId && input.type.key === 'signing_appointment') {
      const { delegateSigningKit } = await import('@/lib/signing/delegateKit')
      await delegateSigningKit({ matterId: input.matterId, scheduledFor: input.startIso ?? null, actorId: input.bookedByUserId ?? null })
    }
  } catch (err) {
    console.error('[appointments] signing kit automation failed', err)
  }
}

/**
 * Send the intake questionnaire invite to a lead who booked a discovery call,
 * unless one was already sent or the intake is already underway.
 */
async function maybeSendIntakeInvite(intakeId: string): Promise<void> {
  const admin = getAdminClient()
  const { data } = await admin
    .from('client_intake')
    .select('id, email, first_name, status, intake_sent_at')
    .eq('id', intakeId)
    .maybeSingle()

  const row = data as {
    id: string
    email: string | null
    first_name: string | null
    status: string | null
    intake_sent_at: string | null
  } | null

  if (!row?.email) return
  if (row.intake_sent_at) return
  if (row.status === 'submitted' || row.status === 'approved') return

  const now = new Date().toISOString()
  const link = await ensureStandingIntakeLink(admin, intakeId)
  if (!link.url) return

  const { error } = await admin
    .from('client_intake')
    .update({
      intake_sent_at: now,
    })
    .eq('id', intakeId)
  if (error) throw error

  const firm = getFirmConfig()
  const url = link.url

  await sendEmail({
    to: row.email,
    category: 'intake_invite',
    subject: `${firm.firmName} — complete your estate planning intake`,
    html: `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;line-height:1.6;color:#1f2937;">
<p>Hi {{firstName}},</p>
<p>Thanks for booking your discovery call. To make the most of our time together, please use the secure link below to create your portal password and complete your intake questionnaire.</p>
<p><a href="{{intakeUrl}}" style="color:#2a7d70;font-weight:600;">Start intake</a></p>
<p style="font-size:13px;color:#6b7280;">You may return to this link until our office revokes or replaces it.</p>
<p>— {{attorneyShortName}}<br/>{{firmName}}</p>
</body></html>`,
    replyTo: firm.email,
    useStoredTemplate: true,
    templateVariables: {
      firstName: row.first_name ?? 'there',
      first_name: row.first_name ?? 'there',
      client_name: row.first_name ?? 'Client',
      intakeUrl: url,
      intake_link: url,
      firmName: firm.firmName,
      attorneyShortName: firm.attorneyShortName,
    },
  })

  await admin.from('lead_activity').insert({
    lead_id: intakeId,
    event_type: 'note',
    title: 'Intake invite sent automatically',
    detail: 'Triggered by discovery call booking',
    actor_id: null,
  })
}

/**
 * Guarded, forward-only stage bumps driven by what was just scheduled. Any
 * current stage outside `from` is left alone.
 *
 * The `pmps` entry is the v1 path and only that. Under v1 the Peace of Mind
 * Planning Session was the design meeting — held after the engagement was
 * signed, to a hired matter sitting in `intake` — which is why the appointment
 * type still carries the slug `design-meeting`. A matter generated on that
 * template can still be in `intake` today, and booking its design meeting
 * should still move it on.
 *
 * v3 moved the session to the pre-engagement stretch, where a lead's stage is
 * `new_lead` or `intake_sent` and never one of these, so this branch cannot
 * fire for one. The v3 move is `stamp_lead_pmps_stage` (20260909000000), which
 * keys off `matters.pmps_at` rather than the booking so the key-dates panel and
 * the webhook path get it too, and it refuses to touch a hired matter — the two
 * cannot both act on the same record.
 */
const STAGE_ADVANCES: Record<string, { from: string[]; to: string } | undefined> = {
  pmps: { from: ['intake', 'intake_review'], to: 'design' },
  signing_appointment: { from: ['drafts_approved'], to: 'signing_scheduled' },
}

async function maybeAdvanceStage(matterId: string, type: AppointmentType): Promise<void> {
  const advance = STAGE_ADVANCES[type.key]
  if (!advance) return

  const admin = getAdminClient()
  // Conditional update makes the forward-only guard race-safe; the returned
  // rows tell us whether the transition actually happened.
  const { data, error } = await admin
    .from('matters')
    .update({ stage: advance.to })
    .eq('id', matterId)
    .in('stage', advance.from)
    .select('id')
  if (error) throw error
  if (!data?.length) return

  const to = advance.to as MatterStage
  await admin.from('matter_activity').insert({
    matter_id: matterId,
    event_type: 'stage_changed',
    title: `Stage changed to ${stageLabel(to)}`,
    detail: `Triggered automatically by ${type.label} booking`,
    metadata: { to: advance.to, trigger: 'appointment_booked' },
    actor_id: null,
  })

  try {
    await fireEngineStageTask(admin, { matterId, matterStage: to })
  } catch (err) {
    console.error('[appointments] fireEngineStageTask failed:', err)
  }
}
