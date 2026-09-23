import { manualCommunicationsEnabled } from '@/lib/communications/providers'
import { notFound } from 'next/navigation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { firmDateKey } from '@/lib/firmDate'
import { createServerSupabase, getCachedUserRole } from '@/lib/supabaseServer'
import { hydrateIntakeWithContacts } from '@/lib/intakeContactHydration'
import { getSchedulingSettings } from '@/lib/appointments/settings'
import { isSmsConfigured } from '@/lib/communications/config'
import { esignDocumentsEnabled } from '@/lib/esign/documentSignature'
import { leadNoteType, newestTimestamp } from '@/lib/leads/timeline'
import { clientContactTimestamps } from '@/lib/leads/contactEvents'
import { leadScoreInputFromRow, scoringAppointmentAt } from '@/lib/leads/score'
import { fetchRecordTaskCounts, isUuid } from '@/lib/queries/tasks'
import { fetchMatter, fetchMatterContacts } from '@/lib/queries/matterCore'
import { standingIntakeUrl } from '@/lib/intake/standingLinks'
import { loadSpouseContact } from '@/lib/contacts/loadSpouseContact'
import { LeadDetailClient } from './LeadDetailClient'

export const dynamic = 'force-dynamic'

type LeadNoteLoaderRow = {
  id: string
  body: string
  /** Absent until the note-type migration reaches this database. */
  note_type?: string | null
  actor_id: string
  created_at: string
  updated_at: string
}

type LeadMeetingNoteLoaderRow = LeadNoteLoaderRow & {
  title: string
  meeting_date: string
  attendees: string[]
  source: string
  granola_note_id: string | null
}

type LeadActivityLoaderRow = {
  id: string
  event_type?: string | null
  title: string
  detail?: string | null
  actor_id?: string | null
  created_at: string
}

type ActorLoaderRow = {
  id: string
  display_name: string | null
  email: string | null
}

function mapNote(note: LeadNoteLoaderRow) {
  return {
    id: note.id,
    body: note.body,
    noteType: leadNoteType(note.note_type),
    actorId: note.actor_id,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
  }
}

function mapMeeting(note: LeadMeetingNoteLoaderRow) {
  const { noteType: _noteType, ...base } = mapNote(note)
  return {
    ...base,
    title: note.title,
    date: note.meeting_date,
    attendees: note.attendees,
    source: note.source,
    granolaNoteId: note.granola_note_id,
  }
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const admin = getAdminClient()
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const [
    leadResult,
    activityResult,
    notesResult,
    meetingsResult,
    appointmentResult,
    initialTaskCounts,
    scoreRowResult,
    emailContactResult,
    smsResponseResult,
  ] = await Promise.all([
    admin.from('client_intake').select('*').eq('id', id).maybeSingle(),
    admin.from('lead_activity').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
    admin.from('lead_notes').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
    admin.from('lead_meeting_notes').select('*').eq('lead_id', id).order('meeting_date', { ascending: false }),
    admin.from('appointments').select('start_time')
      .eq('linked_lead_id', id)
      .gte('start_time', new Date().toISOString())
      .neq('status', 'cancelled')
      .order('start_time', { ascending: true })
      .limit(1)
      .maybeSingle(),
    fetchRecordTaskCounts(id),
    admin.from('v_lead_list').select('*').eq('id', id).maybeSingle(),
    admin.from('email_log').select('sent_at, created_at').eq('lead_id', id).eq('status', 'sent').order('created_at', { ascending: false }).limit(1),
    admin.from('sms_messages').select('created_at').eq('lead_id', id).eq('direction', 'inbound').is('deleted_at', null).order('created_at', { ascending: false }).limit(1),
  ])

  const { data: lead, error: leadError } = leadResult
  const { data: activity, error: activityError } = activityResult
  const { data: notes, error: notesError } = notesResult
  const { data: meetings, error: meetingsError } = meetingsResult
  const { data: appointment, error: appointmentError } = appointmentResult

  if (leadError) console.error('Could not load lead detail', { leadId: id, error: leadError })
  if (!lead || !lead.lead_status) notFound()

  // Read through the join (step 3 of docs/matter-contacts-migration.md), which
  // needs the lead's matter — so this follows the lead read rather than running
  // alongside it. '*' because the rail formats the spouse's address.
  let spouse: Record<string, unknown> | null = null
  try {
    spouse = lead.matter_id
      ? (await loadSpouseContact(admin, lead.matter_id as string, '*')) as Record<string, unknown> | null
      : null
  } catch (spouseError) {
    console.error('Could not load lead spouse', { leadId: id, error: spouseError })
  }
  if (activityError) console.error('Could not load lead activity', { leadId: id, error: activityError })
  if (notesError) console.error('Could not load lead notes', { leadId: id, error: notesError })
  if (meetingsError) console.error('Could not load lead meeting notes', { leadId: id, error: meetingsError })
  if (appointmentError) console.error('Could not load lead appointment', { leadId: id, error: appointmentError })

  const activityRows = (activity ?? []) as LeadActivityLoaderRow[]
  const noteRows = (notes ?? []) as LeadNoteLoaderRow[]
  const meetingRows = (meetings ?? []) as LeadMeetingNoteLoaderRow[]
  const actorIds = [...new Set(
    [
      ...activityRows,
      ...noteRows,
      ...meetingRows,
      ...(user?.id ? [{ actor_id: user.id }] : []),
    ]
      .map(row => row.actor_id)
      .filter((actorId): actorId is string => Boolean(actorId)),
  )]
  const actorResult = actorIds.length > 0
    ? await admin.from('users').select('id, display_name, email').in('id', actorIds)
    : { data: [] as ActorLoaderRow[], error: null }
  if (actorResult.error) {
    console.error('Could not load lead timeline actors', { leadId: id, error: actorResult.error })
  }
  const actorNames = Object.fromEntries(
    ((actorResult.data ?? []) as ActorLoaderRow[]).map(actor => [
      actor.id,
      actor.display_name?.trim() || actor.email?.trim() || 'System',
    ]),
  )
  const contactTimes = clientContactTimestamps(activityRows)
  if (emailContactResult.error) console.error('Could not load lead email contact', { leadId: id, error: emailContactResult.error })
  if (smsResponseResult.error) console.error('Could not load lead SMS response', { leadId: id, error: smsResponseResult.error })
  const lastClientResponseAt = newestTimestamp([
    contactTimes.lastClientResponseAt,
    ...(smsResponseResult.data ?? []).map(row => row.created_at),
  ])
  const lastTouchAt = newestTimestamp([
    contactTimes.lastClientContactAt,
    lastClientResponseAt,
    ...(emailContactResult.data ?? []).map(row => row.sent_at ?? row.created_at),
  ])
  const recordUpdatedAt = newestTimestamp([
    lead.updated_at,
    ...activityRows.map(row => row.created_at),
    ...noteRows.map(row => row.updated_at ?? row.created_at),
    ...meetingRows.map(row => row.updated_at ?? row.created_at),
  ])

  const hydratedLead = await hydrateIntakeWithContacts(admin, lead) as typeof lead & Record<string, unknown>
  let initialIntakeUrl: string | null = null
  if (lead.intake_link_version && !lead.intake_link_revoked_at) {
    initialIntakeUrl = standingIntakeUrl(lead.id, lead.intake_link_version)
  }
  const schedulingSettings = await getSchedulingSettings()
  // A lead's opportunity is never `hired`, so the People tab's matter must be
  // read through the leads-inclusive view or it comes back null for every lead.
  const [peopleMatter, initialPeopleContacts] = lead.matter_id
    ? await Promise.all([
        fetchMatter(lead.matter_id, { includeLeads: true }),
        fetchMatterContacts(lead.matter_id),
      ])
    : [null, []]
  // The pre-engagement clock's anchors live on the opportunity's matter row.
  // The rail edits them, so they load with the page rather than behind the SLA
  // tab's fetch.
  const { data: anchorRow } = lead.matter_id
    ? await admin.from('matters').select('discovery_call_at, pmps_at').eq('id', lead.matter_id).maybeSingle()
    : { data: null }
  const initialKeyDates = lead.matter_id
    ? {
        discoveryCallAt: anchorRow?.discovery_call_at ? firmDateKey(anchorRow.discovery_call_at) : null,
        pmpsAt: anchorRow?.pmps_at ? firmDateKey(anchorRow.pmps_at) : null,
      }
    : null
  // The `appointments` table holds a booking made through the scheduler, and
  // most of the firm's meetings are not: 15 of 37 active leads carry a
  // discovery call or planning session on the matter row and no appointment
  // row at all. `v_lead_list` has always read the anchors — through
  // `lead_scoring_appointment_at()`, the SQL mirror of `scoringAppointmentAt()`
  // — so a lead whose meeting lives only there read "Meeting in 9 days" on its
  // card and "No meeting on the calendar" on its own page, and scored ten
  // points lower there. Same rule on both surfaces now; a real booking still
  // wins, because the query above only returns one that is ahead.
  const nextAppointmentAt = (appointment?.start_time as string | undefined)
    ?? scoringAppointmentAt(anchorRow?.discovery_call_at, anchorRow?.pmps_at)
  const { data: agreement } = lead.matter_id
    ? await admin.from('engagement_agreements').select('id, status').eq('matter_id', lead.matter_id).in('status', ['draft', 'ready', 'failed', 'sending', 'sent', 'viewed', 'partially_signed', 'completed']).order('created_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null }

  if (scoreRowResult.error) console.error('Could not load canonical lead score', { leadId: id, error: scoreRowResult.error })
  // Mirror list inputs even on a view-read failure: raw intake fields, all lead
  // activity, matter milestone dates and no detail-only readiness points.
  const initialScoreInput = leadScoreInputFromRow(scoreRowResult.data?.id ? scoreRowResult.data : {
    ...lead,
    last_activity_at: newestTimestamp(activityRows.map(row => row.created_at)),
    next_appointment_at: scoringAppointmentAt(anchorRow?.discovery_call_at, anchorRow?.pmps_at),
  })

  return (
    <LeadDetailClient
      lead={hydratedLead}
      initialTaskCounts={initialTaskCounts}
      initialIntakeUrl={initialIntakeUrl}
      initialIntakeLinkRevoked={Boolean(lead.intake_link_revoked_at)}
      spouse={spouse}
      initialActivity={activityRows}
      initialNotes={noteRows.map(mapNote)}
      initialMeetingNotes={meetingRows.map(mapMeeting)}
      actorNames={actorNames}
      firmTimezone={schedulingSettings.timezone}
      nextAppointmentAt={nextAppointmentAt}
      lastTouchAt={lastTouchAt}
      lastClientResponseAt={lastClientResponseAt}
      recordUpdatedAt={recordUpdatedAt}
      initialScoreInput={initialScoreInput}
      actorError={actorResult.error?.message ?? null}
      activeAgreement={agreement}
      initialKeyDates={initialKeyDates}
      peopleMatter={peopleMatter}
      initialPeopleContacts={initialPeopleContacts}
      currentUser={{
        id: user?.id ?? '',
        role: user ? await getCachedUserRole(user.id) ?? '' : '',
      }}
      smsEnabled={manualCommunicationsEnabled() && isSmsConfigured()}
      esignDocumentsEnabled={await esignDocumentsEnabled()}
    />
  )
}
