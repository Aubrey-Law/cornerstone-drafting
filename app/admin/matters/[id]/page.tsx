import { notFound } from 'next/navigation'
import { fetchMatter, fetchMatterContacts } from '@/lib/queries/matterCore'
import { fetchMatterAgingHealth } from '@/lib/queries/matterOverview'
import { fetchDesignSheet, fetchIntakeForMatter } from '@/lib/queries'
import { fetchUnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'
import { isTwilioSmsConfigured } from '@/lib/twilio/config'
import { isMicrosoftConfigured } from '@/lib/microsoftCalendar'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isDesignSheetUnseeded, buildIntakeResyncPreview } from '@/lib/designSheet/seedFromIntake'
import type { IntakeReadinessFlag } from '@/lib/intakeReadiness'
import type { MatterNoteRow } from '@/app/actions/matterNotes'
import type { MatterDetailsRow } from '@/types/matter-details'
import MatterDetailClient from './MatterDetailClient'

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
    { data: matterRow },
    { data: detailsRow },
    { data: notes },
    designSheet,
    intakeSnapshot,
  ] = await Promise.all([
    admin.from('matters').select('client_intake_id, matter_number, matter_number_manual, portal_uploads_reviewed_at').eq('id', id).maybeSingle(),
    admin.from('matter_details').select('*').eq('client_id', id).maybeSingle(),
    admin
      .from('matter_notes')
      .select('id, matter_id, note_type, body, author, created_at')
      .eq('matter_id', id)
      .order('created_at', { ascending: false }),
    fetchDesignSheet(id),
    fetchIntakeForMatter(id),
  ])

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
    const { data } = await admin
      .from('client_intake')
      .select('id, intake_sent_at, intake_completed_at, uploads_reviewed_at, email, first_name, status, user_id, client_user_id, unlock_requested_at, unlock_request_note')
      .eq('id', intakeId)
      .maybeSingle()
    clientIntakeRow = data
  }

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
      designSheetSeeded={designSheetSeeded}
      reviewFlags={reviewFlags}
      resyncPreviewCount={resyncPreviewCount}
      twilioSmsEnabled={isTwilioSmsConfigured()}
      emailSendEnabled={isMicrosoftConfigured() || Boolean(process.env.RESEND_API_KEY)}
    />
  )
}
