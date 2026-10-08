import 'server-only'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchDesignSheet, fetchMatter, fetchMatterContacts } from '@/lib/queries/matterCore'
import { fetchMatterAgingSummary, fetchMatterEstateSnapshot } from '@/lib/queries/matterOverview'
import { fetchMatterStageHistory } from '@/lib/queries/matterStageHistory'
import { fetchRecordTaskCounts } from '@/lib/queries/tasks'
import { fetchUnreviewedUploadCounts } from '@/lib/matter/unreviewedUploads'
import { buildMatterPlanMirror } from '@/lib/matter/planMirror'
import { isEsignConfigured } from '@/lib/esign/firma'
import { reviewClient } from '@/lib/review/staff'
import { loadUnresolvedBlockers } from '@/lib/runs/advisory'
import { fetchWorkGraphForUser } from '@/lib/work/server'
import { buildRecordWorkSummaries } from '@/lib/work/recordSummary'
import { loadClientIntakeShell, loadMatterShell } from '@/lib/matters/matterShell'
import type { MatterDetailsRow } from '@/types/matter-details'

/**
 * What the shared matter header and Details panel need outside the matter page
 * itself (the drafting route): identity, stage, details, intake, counts and the
 * record's work summary. The matter page loads the same facts with its own,
 * larger reads; this stays to the header's share.
 */
export async function loadMatterWorkspaceFrame(matterId: string, userId: string) {
  const admin = getAdminClient()
  const shell = loadMatterShell(admin, matterId)
  const intake = shell.then(async row => {
    const intakeId = row?.client_intake_id ?? null
    const clientIntake = intakeId ? await loadClientIntakeShell(admin, intakeId) : null
    const [uploadCounts, estate] = await Promise.all([
      fetchUnreviewedUploadCounts(admin, matterId, intakeId, clientIntake?.uploads_reviewed_at ?? null, row?.portal_uploads_reviewed_at ?? null),
      fetchMatterEstateSnapshot(intakeId),
    ])
    return { intakeId, clientIntake, uploadCounts, estate }
  })
  const [matter, contacts, matterRow, { data: detailsRow, error: detailsError }, designSheet, agingSummary, stageHistory, taskCounts, intakeContext, graph, reviewBlockerCount] = await Promise.all([
    fetchMatter(matterId),
    fetchMatterContacts(matterId),
    shell,
    admin.from('matter_details').select('*').eq('client_id', matterId).maybeSingle(),
    fetchDesignSheet(matterId),
    fetchMatterAgingSummary(matterId),
    fetchMatterStageHistory(matterId),
    fetchRecordTaskCounts(matterId),
    intake,
    fetchWorkGraphForUser(userId),
    loadUnresolvedBlockers(reviewClient())
      .then(blockers => blockers.find(blocker => blocker.matterId === matterId)?.ruleNumbers.length ?? 0)
      .catch(() => 0),
  ])
  if (!matter) return null
  if (detailsError) throw new Error(`Could not load matter details: ${detailsError.message}`)
  const details = (detailsRow ?? null) as MatterDetailsRow | null
  return {
    matter,
    matterNumber: (matterRow?.matter_number ?? details?.matter_number ?? null) as string | null,
    matterNumberManual: Boolean(matterRow?.matter_number_manual),
    matterType: matterRow?.matter_type ?? null,
    details,
    designSheetPlanType: (designSheet?.plan_type as string | null | undefined) ?? null,
    planMirror: buildMatterPlanMirror(designSheet, contacts, details, { clientName: matter.client_name, spouseName: matter.spouse_name }),
    estate: intakeContext.estate,
    agingSummary,
    stageHistory: stageHistory.entries,
    intakeId: intakeContext.intakeId,
    intakeCompleted: Boolean(intakeContext.clientIntake?.intake_completed_at || matter.intake_status === 'completed'),
    clientUserId: intakeContext.clientIntake?.client_user_id ?? intakeContext.clientIntake?.user_id ?? null,
    uploadCounts: intakeContext.uploadCounts,
    taskCount: taskCounts.open,
    reviewBlockerCount,
    esignEnabled: isEsignConfigured(),
    workSummary: buildRecordWorkSummaries(graph.items, 'matter')[matterId] ?? null,
  }
}

export type MatterWorkspaceFrameData = NonNullable<Awaited<ReturnType<typeof loadMatterWorkspaceFrame>>>
