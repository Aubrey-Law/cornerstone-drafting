import { notFound } from 'next/navigation'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { createServerSupabase, getCachedUserRole } from '@/lib/supabaseServer'
import { hydrateIntakeWithContacts } from '@/lib/intakeContactHydration'
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
    { data: lead },
    { data: spouse },
    { data: activity },
    { data: notes },
    { data: meetings },
  ] = await Promise.all([
    admin.from('client_intake').select('*').eq('id', id).maybeSingle(),
    admin.from('contacts').select('*').eq('client_intake_id', id).eq('relationship_type', 'spouse').maybeSingle(),
    admin.from('lead_activity').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
    admin.from('lead_notes').select('*').eq('lead_id', id).order('created_at', { ascending: false }),
    admin.from('lead_meeting_notes').select('*').eq('lead_id', id).order('meeting_date', { ascending: false }),
  ])

  if (!lead || !lead.lead_status) notFound()
  const hydratedLead = await hydrateIntakeWithContacts(admin, lead) as typeof lead & Record<string, unknown>
  const { data: agreement } = lead.matter_id
    ? await admin.from('engagement_agreements').select('id').eq('matter_id', lead.matter_id).in('status', ['draft', 'ready', 'failed']).order('created_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null }

  return (
    <LeadDetailClient
      lead={hydratedLead}
      spouse={spouse}
      initialActivity={activity ?? []}
      initialNotes={((notes ?? []) as LeadNoteLoaderRow[]).map(mapNote)}
      initialMeetingNotes={((meetings ?? []) as LeadMeetingNoteLoaderRow[]).map(mapMeeting)}
      activeAgreement={agreement}
      currentUser={{
        id: user?.id ?? '',
        role: user ? await getCachedUserRole(user.id) ?? '' : '',
      }}
    />
  )
}
