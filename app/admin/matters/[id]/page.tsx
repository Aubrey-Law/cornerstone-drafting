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
import MatterDetailClient from './MatterDetailClient'
import { mapMatterNoteRows } from './tabs/notes'
import { mergeLeadAndMatterActivity } from '@/lib/leads/activity'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

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
    { data: notes, error: notesError },
    designSheet,
    intakeSnapshot,
    { data: matterActivity, error: matterActivityError },
  ] = await Promise.all([
    admin.from('matters').select('client_intake_id, matter_number, matter_number_manual, portal_uploads_reviewed_at').eq('id', id).maybeSingle(),
    admin.from('matter_details').select('*').eq('client_id', id).maybeSingle(),
    admin
      .from('matter_notes')
      .select('id, matter_id, note_type, body, author, created_at, source_lead_note_id')
      .eq('matter_id', id)
      .order('created_at', { ascending: false }),
    fetchDesignSheet(id),
    fetchIntakeForMatter(id),
    admin.from('matter_activity').select('*').eq('matter_id', id).order('created_at', { ascending: false }).limit(50),
  ])

  const coreLoadError = matterRowError ?? detailsError ?? notesError ?? matterActivityError
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

  const [{ data: leadNotes, error: leadNotesError }, { data: leadMeetingNotes, error: leadMeetingNotesError }, { data: leadActivity, error: leadActivityError }] = intakeId
    ? await Promise.all([
        admin.from('lead_notes').select('id, body, created_at').eq('lead_id', intakeId).order('created_at', { ascending: false }),
        admin.from('lead_meeting_notes').select('id, title, body, meeting_date').eq('lead_id', intakeId).order('meeting_date', { ascending: false }),
        admin.from('lead_activity').select('id, event_type, title, detail, actor_id, created_at, source_matter_activity_id').eq('lead_id', intakeId).order('created_at', { ascending: false }).limit(200),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }]

  const linkedHistoryError = leadNotesError ?? leadMeetingNotesError ?? leadActivityError
  if (linkedHistoryError) throw new Error(`Could not load linked lead history: ${linkedHistoryError.message}`)

  const initialActivity = mergeLeadAndMatterActivity(
    (leadActivity ?? []).map(row => ({
      id: row.id, matter_id: id, event_type: row.event_type, actor_id: row.actor_id,
      actor_email: null, actor_name: null, title: row.title, detail: row.detail,
      metadata: { origin: 'lead', source_lead_activity_id: row.id }, created_at: row.created_at,
      createdAt: row.created_at,
    })),
    (matterActivity ?? []).map(row => ({
      ...row, createdAt: row.created_at,
      sourceLeadActivityId: typeof row.metadata?.source_lead_activity_id === 'string' ? row.metadata.source_lead_activity_id : null,
    })),
  ).map(row => row.metadata?.origin === 'lead' ? { ...row, id: `lead:${row.id}` } : row)

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
      initialNotes={(notes ?? []) as MatterNoteRow[]}
      initialMatterLinkedNotes={mapMatterNoteRows(notes ?? [])}
      initialLeadNotes={[
        ...(leadNotes ?? []).map(row => ({ ...row, lead_id: intakeId!, note_type: 'internal' as const })),
        ...(leadMeetingNotes ?? []).map(row => ({ id: row.id, lead_id: intakeId!, body: `${row.title}\n\n${row.body}`, created_at: row.meeting_date, note_type: 'system' as const })),
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
