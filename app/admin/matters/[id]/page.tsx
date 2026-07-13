import { notFound } from 'next/navigation'
import { fetchMatter, fetchMatterContacts } from '@/lib/queries/matterCore'
import { fetchMatterAgingHealth } from '@/lib/queries/matterOverview'
import { fetchDesignSheet, fetchIntakeForMatter } from '@/lib/queries'
import { fetchUnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'
import { isTwilioSmsConfigured } from '@/lib/twilio/config'
import { isEsignConfigured } from '@/lib/esign/firma'
import { isMicrosoftConfigured } from '@/lib/microsoftCalendar'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isDesignSheetUnseeded, buildIntakeResyncPreview } from '@/lib/designSheet/seedFromIntake'
import type { IntakeReadinessFlag } from '@/lib/intakeReadiness'
import type { MatterNoteRow } from '@/app/actions/matterNotes'
import type { MatterDetailsRow } from '@/types/matter-details'
import type { MatterActivity } from '@/types/database'
import MatterDetailClient from './MatterDetailClient'
import { mapMatterNoteRows } from './tabs/notes'
import { buildLinkedMatterActivity } from '@/lib/leads/activity'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }
type SupabaseMaybeError = { code?: string; message?: string; details?: string; hint?: string } | null
type MatterNoteLoaderRow = Pick<MatterNoteRow, 'id' | 'matter_id' | 'note_type' | 'body' | 'author' | 'created_at'> & {
  source_lead_note_id: string | null
}
type LeadNoteLoaderRow = { id: string; body: string; created_at: string }
type LeadMeetingNoteLoaderRow = { id: string; title: string; body: string; meeting_date: string }
type LeadActivityLoaderRow = {
  id: string
  event_type: string
  title: string
  detail: string | null
  actor_id: string | null
  created_at: string
  source_matter_activity_id: string | null
}

const MATTER_NOTE_COLUMNS_WITH_PROVENANCE = 'id, matter_id, note_type, body, author, created_at, source_lead_note_id'
const MATTER_NOTE_COLUMNS_BASE = 'id, matter_id, note_type, body, author, created_at'

function isOptionalHistorySchemaError(error: SupabaseMaybeError) {
  if (!error) return false
  const text = `${error.code ?? ''} ${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase()
  return (
    text.includes('source_lead_note_id') ||
    text.includes('source_matter_activity_id') ||
    text.includes('lead_meeting_notes') ||
    text.includes('lead_activity') ||
    text.includes('schema cache') ||
    text.includes('could not find') ||
    text.includes('does not exist')
  )
}

async function loadMatterNotes(admin: ReturnType<typeof getAdminClient>, matterId: string) {
  const withProvenance = await admin
    .from('matter_notes')
    .select(MATTER_NOTE_COLUMNS_WITH_PROVENANCE)
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false })

  if (!withProvenance.error) return withProvenance.data as MatterNoteLoaderRow[]
  if (!isOptionalHistorySchemaError(withProvenance.error)) {
    throw new Error(`Could not load matter history: ${withProvenance.error.message}`)
  }

  console.warn('Matter note provenance unavailable; loading base matter notes only:', withProvenance.error.message)
  const base = await admin
    .from('matter_notes')
    .select(MATTER_NOTE_COLUMNS_BASE)
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false })

  if (base.error) throw new Error(`Could not load matter history: ${base.error.message}`)
  return ((base.data ?? []) as Omit<MatterNoteLoaderRow, 'source_lead_note_id'>[])
    .map(row => ({ ...row, source_lead_note_id: null }))
}

async function loadLinkedLeadHistory(admin: ReturnType<typeof getAdminClient>, intakeId: string | null) {
  if (!intakeId) {
    return {
      leadNotes: [] as LeadNoteLoaderRow[],
      leadMeetingNotes: [] as LeadMeetingNoteLoaderRow[],
      leadActivity: [] as LeadActivityLoaderRow[],
    }
  }

  const [leadNotes, leadMeetingNotes, leadActivity] = await Promise.all([
    admin.from('lead_notes').select('id, body, created_at').eq('lead_id', intakeId).order('created_at', { ascending: false }),
    admin.from('lead_meeting_notes').select('id, title, body, meeting_date').eq('lead_id', intakeId).order('meeting_date', { ascending: false }),
    admin.from('lead_activity').select('id, event_type, title, detail, actor_id, created_at, source_matter_activity_id').eq('lead_id', intakeId).order('created_at', { ascending: false }).limit(200),
  ])

  const linkedHistoryError = leadNotes.error ?? leadMeetingNotes.error ?? leadActivity.error
  if (linkedHistoryError) {
    if (!isOptionalHistorySchemaError(linkedHistoryError)) {
      console.warn('Linked lead history unavailable:', linkedHistoryError.message)
    } else {
      console.warn('Linked lead history schema unavailable; continuing without linked lead history:', linkedHistoryError.message)
    }
    return { leadNotes: [] as LeadNoteLoaderRow[], leadMeetingNotes: [] as LeadMeetingNoteLoaderRow[], leadActivity: [] as LeadActivityLoaderRow[] }
  }

  return {
    leadNotes: (leadNotes.data ?? []) as LeadNoteLoaderRow[],
    leadMeetingNotes: (leadMeetingNotes.data ?? []) as LeadMeetingNoteLoaderRow[],
    leadActivity: (leadActivity.data ?? []) as LeadActivityLoaderRow[],
  }
}

export default async function MatterDetailPage({ params }: Params) {
  const { id } = await params
  const [matter, contacts, agingHealth] = await Promise.all([
    fetchMatter(id),
    fetchMatterContacts(id),
    fetchMatterAgingHealth(id),
  ])

  if (!matter) notFound()

  const admin = getAdminClient()
  const [
    { data: matterRow, error: matterRowError },
    { data: detailsRow, error: detailsError },
    notes,
    designSheet,
    intakeSnapshot,
    { data: matterActivity, error: matterActivityError },
  ] = await Promise.all([
    admin.from('matters').select('client_intake_id, matter_number, matter_number_manual, portal_uploads_reviewed_at').eq('id', id).maybeSingle(),
    admin.from('matter_details').select('*').eq('client_id', id).maybeSingle(),
    loadMatterNotes(admin, id),
    fetchDesignSheet(id),
    fetchIntakeForMatter(id),
    admin.from('matter_activity').select('*').eq('matter_id', id).order('created_at', { ascending: false }).limit(50),
  ])

  const coreLoadError = matterRowError ?? detailsError ?? matterActivityError
  if (coreLoadError) throw new Error(`Could not load matter history: ${coreLoadError.message}`)

  const intakeId = (matterRow?.client_intake_id ?? null) as string | null
  let clientIntakeRow: {
    id: string
    intake_sent_at: string | null
    intake_completed_at: string | null
    uploads_reviewed_at?: string | null
    email: string | null
    first_name: string | null
    status?: string | null
    user_id?: string | null
    client_user_id?: string | null
    unlock_requested_at?: string | null
    unlock_request_note?: string | null
  } | null = null

  if (intakeId) {
    const { data, error: clientIntakeError } = await admin
      .from('client_intake')
      .select('id, intake_sent_at, intake_completed_at, uploads_reviewed_at, email, first_name, status, user_id, client_user_id, unlock_requested_at, unlock_request_note')
      .eq('id', intakeId)
      .maybeSingle()
    if (clientIntakeError) throw new Error(`Could not load client intake: ${clientIntakeError.message}`)
    clientIntakeRow = data
  }

  const { leadNotes, leadMeetingNotes, leadActivity } = await loadLinkedLeadHistory(admin, intakeId)

  const initialActivity = buildLinkedMatterActivity(id, leadActivity, (matterActivity ?? []) as MatterActivity[])

  const matterNumber = (matterRow?.matter_number ?? detailsRow?.matter_number ?? null) as string | null
  const matterNumberManual = Boolean(matterRow?.matter_number_manual)
  const designSheetSeeded = Boolean(designSheet?.id) && !isDesignSheetUnseeded(designSheet)
  const reviewFlags = ((designSheet as { intake_review_flags?: IntakeReadinessFlag[] } | null)?.intake_review_flags ?? []) as IntakeReadinessFlag[]
  const resyncPreviewCount = intakeSnapshot && designSheet
    ? buildIntakeResyncPreview({
        currentSheet: designSheet as unknown as Record<string, unknown>,
        intake: intakeSnapshot,
      }).filter(row => row.selected && row.currentDisplay !== row.proposedDisplay).length
    : 0

  const portalUploadsReviewedAt = (matterRow?.portal_uploads_reviewed_at ?? null) as string | null
  const unreviewedUploadCounts = await fetchUnreviewedUploadCounts(
    admin,
    id,
    intakeId,
    clientIntakeRow?.uploads_reviewed_at ?? null,
    portalUploadsReviewedAt,
  ).catch(() => ({ intake: 0, portal: 0, total: 0 }))

  return (
    <MatterDetailClient
      matter={matter}
      matterId={id}
      contacts={contacts}
      agingHealth={agingHealth}
      intakeId={intakeId}
      clientIntakeRow={clientIntakeRow}
      matterNumber={matterNumber}
      matterNumberManual={matterNumberManual}
      matterDetails={(detailsRow ?? null) as MatterDetailsRow | null}
      designSheetPlanType={(designSheet?.plan_type as string | null | undefined) ?? null}
      unreviewedUploadCounts={unreviewedUploadCounts}
      initialNotes={notes as MatterNoteRow[]}
      initialMatterLinkedNotes={mapMatterNoteRows(notes)}
      initialLeadNotes={[
        ...leadNotes.map(row => ({ ...row, lead_id: intakeId!, note_type: 'internal' as const })),
        ...leadMeetingNotes.map(row => ({ id: row.id, lead_id: intakeId!, body: `${row.title}\n\n${row.body}`, created_at: row.meeting_date, note_type: 'system' as const })),
      ]}
      initialActivity={initialActivity}
      designSheetSeeded={designSheetSeeded}
      reviewFlags={reviewFlags}
      resyncPreviewCount={resyncPreviewCount}
      twilioSmsEnabled={isTwilioSmsConfigured()}
      esignEnabled={isEsignConfigured()}
      emailSendEnabled={isMicrosoftConfigured() || Boolean(process.env.RESEND_API_KEY)}
    />
  )
}
