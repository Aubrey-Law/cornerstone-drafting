import { manualCommunicationsEnabled } from '@/lib/communications/providers'
import { notFound } from 'next/navigation'
import { fetchMatter, fetchMatterContacts } from '@/lib/queries/matterCore'
import { fetchMatterAgingSummary, fetchMatterEstateSnapshot } from '@/lib/queries/matterOverview'
import { fetchMatterStageHistory } from '@/lib/queries/matterStageHistory'
import { fetchDesignSheet, fetchIntakeForMatter } from '@/lib/queries'
import { fetchUnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'
import { isSmsConfigured } from '@/lib/communications/config'
import { isEsignConfigured } from '@/lib/esign/firma'
import { esignDocumentsEnabled } from '@/lib/esign/documentSignature'
import { isGoogleConfigured } from '@/lib/googleCalendar'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { resolveMatterId } from '@/lib/draftPayload/resolveMatterId'
import { isDesignSheetUnseeded, buildIntakeResyncPreview } from '@/lib/designSheet/seedFromIntake'
import { resolveIntakeReviewFlags, type IntakeReadinessFlag } from '@/lib/intakeReadiness'
import { buildMatterPlanMirror } from '@/lib/matter/planMirror'
import type { MatterNoteRow } from '@/app/actions/matterNotes'
import type { MatterDetailsRow } from '@/types/matter-details'
import type { MatterActivity } from '@/types/database'
import { fetchRecordTaskCounts } from '@/lib/queries/tasks'
import MatterDetailClient from './MatterDetailClient'
import { mapMatterNoteRows } from './tabs/noteLinks'
import { buildLinkedMatterActivity } from '@/lib/leads/activity'
import type { IntakeSnapshot } from '@/lib/queries'
import { profileMatterDetail } from '@/lib/performance/matterDetailTiming'
import { getCachedClaims } from '@/lib/supabaseServer'
import { fetchWorkGraphForUser } from '@/lib/work/server'
import { buildRecordWorkSummaries } from '@/lib/work/recordSummary'

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
type MatterShellRow = {
  client_intake_id: string | null
  matter_number?: string | null
  matter_type?: 'individual' | 'couple' | null
  matter_number_manual?: boolean | null
  portal_uploads_reviewed_at?: string | null
}
type ClientIntakeShellRow = {
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
}

const MATTER_NOTE_COLUMNS_WITH_PROVENANCE = 'id, matter_id, note_type, body, author, created_at, source_lead_note_id'
const MATTER_NOTE_COLUMNS_BASE = 'id, matter_id, note_type, body, author, created_at'
const MATTER_SHELL_COLUMNS_FULL = 'client_intake_id, matter_number, matter_type, matter_number_manual, portal_uploads_reviewed_at'
const MATTER_SHELL_COLUMNS_BASE = 'client_intake_id, matter_number'
const CLIENT_INTAKE_COLUMNS_FULL = 'id, intake_sent_at, intake_completed_at, uploads_reviewed_at, email, first_name, status, user_id, client_user_id, unlock_requested_at, unlock_request_note'
const CLIENT_INTAKE_COLUMNS_BASE = 'id, intake_sent_at, email, first_name, status, user_id, client_user_id'

function normalizeClientIntakeShell(row: Partial<ClientIntakeShellRow> | null): ClientIntakeShellRow | null {
  if (!row?.id) return null
  return {
    id: row.id,
    intake_sent_at: row.intake_sent_at ?? null,
    intake_completed_at: row.intake_completed_at ?? null,
    uploads_reviewed_at: row.uploads_reviewed_at ?? null,
    email: row.email ?? null,
    first_name: row.first_name ?? null,
    status: row.status ?? null,
    user_id: row.user_id ?? null,
    client_user_id: row.client_user_id ?? null,
    unlock_requested_at: row.unlock_requested_at ?? null,
    unlock_request_note: row.unlock_request_note ?? null,
  }
}

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

async function loadMatterShell(admin: ReturnType<typeof getAdminClient>, matterId: string): Promise<MatterShellRow | null> {
  const full = await admin
    .from('matters')
    .select(MATTER_SHELL_COLUMNS_FULL)
    .eq('id', matterId)
    .maybeSingle()

  if (!full.error) return full.data as MatterShellRow | null
  if (!isOptionalHistorySchemaError(full.error)) throw new Error(`Could not load matter history: ${full.error.message}`)

  console.warn('Matter detail optional matter columns unavailable; loading base matter row only:', full.error.message)
  const base = await admin
    .from('matters')
    .select(MATTER_SHELL_COLUMNS_BASE)
    .eq('id', matterId)
    .maybeSingle()

  if (base.error) throw new Error(`Could not load matter history: ${base.error.message}`)
  return base.data as MatterShellRow | null
}

async function loadMatterActivity(admin: ReturnType<typeof getAdminClient>, matterId: string): Promise<MatterActivity[]> {
  const { data, error } = await admin
    .from('matter_activity')
    .select('*')
    .eq('matter_id', matterId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (!error) return (data ?? []) as MatterActivity[]
  console.warn('Matter activity unavailable; continuing without activity timeline:', error.message)
  return []
}

async function loadClientIntakeShell(admin: ReturnType<typeof getAdminClient>, intakeId: string): Promise<ClientIntakeShellRow | null> {
  const full = await admin
    .from('client_intake')
    .select(CLIENT_INTAKE_COLUMNS_FULL)
    .eq('id', intakeId)
    .maybeSingle()

  if (!full.error) return normalizeClientIntakeShell(full.data as Partial<ClientIntakeShellRow> | null)
  if (!isOptionalHistorySchemaError(full.error)) throw new Error(`Could not load client intake: ${full.error.message}`)

  console.warn('Client intake optional columns unavailable; loading base intake row only:', full.error.message)
  const base = await admin
    .from('client_intake')
    .select(CLIENT_INTAKE_COLUMNS_BASE)
    .eq('id', intakeId)
    .maybeSingle()

  if (base.error) throw new Error(`Could not load client intake: ${base.error.message}`)
  return normalizeClientIntakeShell(base.data as Partial<ClientIntakeShellRow> | null)
}

async function loadIntakeSnapshotOptional(matterId: string): Promise<IntakeSnapshot | null> {
  try {
    return await fetchIntakeForMatter(matterId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.warn('Matter intake snapshot unavailable; continuing without resync preview:', message)
    return null
  }
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
  return profileMatterDetail(async measure => {
    const { id: rawId } = await params
    const admin = getAdminClient()
    const id = await measure('identity', () => resolveMatterId(rawId, admin)).catch(error => { if (error instanceof Error && error.name === 'MatterReferenceNotFoundError') return null; throw error })
    if (!id) notFound()
    // Identity is resolved first. All independent reads then overlap rather
    // than waiting for a second round trip after the matter overview.
    const matterShell = measure('matter-shell', () => loadMatterShell(admin, id))
    // Intake-dependent reads wait only for their own parent, not for design,
    // notes, aging, and task reads that happen alongside them.
    const intakeContext = matterShell.then(async matterRow => {
      const intakeId = matterRow?.client_intake_id ?? null
      const clientIntake = intakeId ? measure('client-intake', () => loadClientIntakeShell(admin, intakeId)) : Promise.resolve(null)
      const uploads = clientIntake.then(row => measure('upload-counts', () => fetchUnreviewedUploadCounts(
        admin, id, intakeId, row?.uploads_reviewed_at ?? null,
        matterRow?.portal_uploads_reviewed_at ?? null,
      )))
      const [initialEstateSnapshot, clientIntakeRow, linkedHistory, unreviewedUploadCounts] = await Promise.all([
        measure('estate', () => fetchMatterEstateSnapshot(intakeId)),
        clientIntake,
        measure('lead-history', () => loadLinkedLeadHistory(admin, intakeId)),
        uploads,
      ])
      return { intakeId, initialEstateSnapshot, clientIntakeRow, linkedHistory, unreviewedUploadCounts }
    })
    const [matter, contacts, agingSummary, matterRow,
      { data: detailsRow, error: detailsError }, notes, designSheet,
      intakeSnapshot, matterActivity, stageHistory, initialTaskCounts, context,
      documentSignaturesEnabled,
      workGraph,
    ] = await Promise.all([
      measure('core', () => fetchMatter(id)),
      measure('contacts', () => fetchMatterContacts(id)),
      measure('aging', () => fetchMatterAgingSummary(id)),
      matterShell,
      measure('details', () => admin.from('matter_details').select('*').eq('client_id', id).maybeSingle()),
      measure('notes', () => loadMatterNotes(admin, id)),
      measure('design', () => fetchDesignSheet(id)),
      measure('intake-snapshot', () => loadIntakeSnapshotOptional(id)),
      measure('activity', () => loadMatterActivity(admin, id)),
      measure('stage-history', () => fetchMatterStageHistory(id)),
      measure('task-counts', () => fetchRecordTaskCounts(id)),
      intakeContext,
      measure('esign-documents', () => esignDocumentsEnabled()),
      measure('work-graph', async () => {
        const auth = await getCachedClaims()
        return fetchWorkGraphForUser(auth?.id ?? null)
      }),
    ])
    if (!matter) notFound()

    const coreLoadError = detailsError
    if (coreLoadError) throw new Error(`Could not load matter history: ${coreLoadError.message}`)

    const { intakeId, initialEstateSnapshot, clientIntakeRow, linkedHistory, unreviewedUploadCounts } = context
    const { leadNotes, leadMeetingNotes, leadActivity } = linkedHistory

    const initialActivity = buildLinkedMatterActivity(id, leadActivity, matterActivity)

    const matterNumber = (matterRow?.matter_number ?? detailsRow?.matter_number ?? null) as string | null
    const matterNumberManual = Boolean(matterRow?.matter_number_manual)
    const designSheetSeeded = Boolean(designSheet?.id) && !isDesignSheetUnseeded(designSheet)
    // The stored flags are a snapshot of the intake submission. Resolve them against
    // the design sheet so anything the attorney has since answered — a named
    // fiduciary, a filled-in DOB — stops being reported as outstanding.
    const storedReviewFlags = ((designSheet as { intake_review_flags?: IntakeReadinessFlag[] } | null)?.intake_review_flags ?? []) as IntakeReadinessFlag[]
    const reviewFlags = resolveIntakeReviewFlags(
      storedReviewFlags,
      designSheet as unknown as Record<string, unknown> | null,
    )
    const resyncPreviewCount = intakeSnapshot && designSheet
      ? buildIntakeResyncPreview({
          currentSheet: designSheet as unknown as Record<string, unknown>,
          intake: intakeSnapshot,
        }).filter(row => row.selected && row.currentDisplay !== row.proposedDisplay).length
      : 0

    // Plan composition and fiduciaries belong to the design sheet; the matter
    // page renders them read-only, so resolve them to names here rather than
    // shipping the whole sheet to the client.
    const planMirror = buildMatterPlanMirror(
      designSheet,
      contacts,
      (detailsRow ?? null) as MatterDetailsRow | null,
      { clientName: matter.client_name, spouseName: matter.spouse_name },
    )

    return (
      <MatterDetailClient
        matter={matter}
        matterId={id}
        initialTaskCounts={initialTaskCounts}
        contacts={contacts}
        agingSummary={agingSummary}
        intakeId={intakeId}
        clientIntakeRow={clientIntakeRow}
        matterNumber={matterNumber}
        matterNumberManual={matterNumberManual}
        initialMatterType={(matterRow?.matter_type as 'individual' | 'couple' | null | undefined) ?? null}
        matterDetails={(detailsRow ?? null) as MatterDetailsRow | null}
        designSheetPlanType={(designSheet?.plan_type as string | null | undefined) ?? null}
        planMirror={planMirror}
        initialEstateSnapshot={initialEstateSnapshot}
        unreviewedUploadCounts={unreviewedUploadCounts}
        initialNotes={notes as MatterNoteRow[]}
        initialMatterLinkedNotes={mapMatterNoteRows(notes)}
        initialLeadNotes={[
          ...leadNotes.map(row => ({ ...row, lead_id: intakeId!, note_type: 'internal' as const })),
          ...leadMeetingNotes.map(row => ({ id: row.id, lead_id: intakeId!, body: `${row.title}\n\n${row.body}`, created_at: row.meeting_date, note_type: 'system' as const })),
        ]}
        initialActivity={initialActivity}
        initialStageHistory={stageHistory.entries}
        designSheetSeeded={designSheetSeeded}
        reviewFlags={reviewFlags}
        resyncPreviewCount={resyncPreviewCount}
        smsEnabled={manualCommunicationsEnabled() && isSmsConfigured()}
        esignEnabled={isEsignConfigured()}
        esignDocumentsEnabled={documentSignaturesEnabled}
        emailSendEnabled={isGoogleConfigured() || Boolean(process.env.RESEND_API_KEY)}
        workSummary={buildRecordWorkSummaries(workGraph.items, 'matter')[id] ?? null}
      />
    )
  })
}
