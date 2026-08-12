import { notFound } from 'next/navigation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { createServerSupabase, getCachedUserRole } from '@/lib/supabaseServer'
import { hydrateIntakeWithContacts } from '@/lib/intakeContactHydration'
import { getSchedulingSettings } from '@/lib/appointments/settings'
import { isSmsConfigured } from '@/lib/communications/config'
import { newestTimestamp } from '@/lib/leads/timeline'
import { fetchTasksForLead } from '@/lib/queries/tasks'
import { fetchMatter, fetchMatterContacts } from '@/lib/queries/matterCore'
import { standingIntakeUrl } from '@/lib/intake/standingLinks'
import { recordTaskCounts } from '@/lib/tasks/types'
import { LeadDetailClient } from './LeadDetailClient'

export const dynamic = 'force-dynamic'

type LeadNoteLoaderRow = {
  id: string
  body: string
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
    actorId: note.actor_id,
    createdAt: note.created_at,
    updatedAt: note.updated_at,
  }
}

function mapMeeting(note: LeadMeetingNoteLoaderRow) {
  return {
    ...mapNote(note),
    title: note.title,
    date: note.meeting_date,
    attendees: note.attendees,
    source: note.source,
    granolaNoteId: note.granola_note_id,
  }
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = getAdminClient()
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  const [
    leadResult,
    spouseResult,
    activityResult,
    notesResult,
    meetingsResult,
    appointmentResult,
  ] = await Promise.all([
    admin.from('client_intake').select('*').eq('id', id).maybeSingle(),
    admin.from('contacts').select('*').eq('client_intake_id', id).eq('relationship_type', 'spouse').maybeSingle(),
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
  ])

  const { data: lead, error: leadError } = leadResult
  const { data: spouse, error: spouseError } = spouseResult
  const { data: activity, error: activityError } = activityResult
  const { data: notes, error: notesError } = notesResult
  const { data: meetings, error: meetingsError } = meetingsResult
  const { data: appointment, error: appointmentError } = appointmentResult

  if (leadError) console.error('Could not load lead detail', { leadId: id, error: leadError })
  if (!lead || !lead.lead_status) notFound()
  if (spouseError) console.error('Could not load lead spouse', { leadId: id, error: spouseError })
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
  const lastTouchAt = newestTimestamp([
    ...activityRows.map(row => row.created_at),
    ...noteRows.map(row => row.created_at),
    ...meetingRows.map(row => row.created_at),
  ])

  const hydratedLead = await hydrateIntakeWithContacts(admin, lead) as typeof lead & Record<string, unknown>
  let initialIntakeUrl: string | null = null
  if (lead.intake_link_version && !lead.intake_link_revoked_at) {
    initialIntakeUrl = standingIntakeUrl(lead.id, lead.intake_link_version)
  }
  const schedulingSettings = await getSchedulingSettings()
  const initialTaskCounts = recordTaskCounts(await fetchTasksForLead(id, 'open'))
  const [peopleMatter, initialPeopleContacts] = lead.matter_id
    ? await Promise.all([
        fetchMatter(lead.matter_id),
        fetchMatterContacts(lead.matter_id),
      ])
    : [null, []]
  const { data: agreement } = lead.matter_id
    ? await admin.from('engagement_agreements').select('id').eq('matter_id', lead.matter_id).in('status', ['draft', 'ready', 'failed']).order('created_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null }

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
      nextAppointmentAt={appointment?.start_time ?? null}
      lastTouchAt={lastTouchAt}
      actorError={actorResult.error?.message ?? null}
      activeAgreement={agreement}
      peopleMatter={peopleMatter}
      initialPeopleContacts={initialPeopleContacts}
      currentUser={{
        id: user?.id ?? '',
        role: user ? await getCachedUserRole(user.id) ?? '' : '',
      }}
      smsEnabled={isSmsConfigured()}
    />
  )
}
