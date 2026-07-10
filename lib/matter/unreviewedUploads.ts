import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

type AdminClient = SupabaseClient<Database>

const EPOCH_ISO = '1970-01-01T00:00:00.000Z'

export interface UnreviewedUploadCounts {
  intake: number
  portal: number
  total: number
}

export function mergeUnreviewedCounts(intake: number, portal: number): UnreviewedUploadCounts {
  return { intake, portal, total: intake + portal }
}

export function countUnreviewedFromDocuments(
  docs: Array<{ created_at: string }>,
  reviewedAt: string | null | undefined,
): number {
  const sinceMs = reviewedAt ? Date.parse(reviewedAt) : 0
  if (Number.isNaN(sinceMs)) {
    return docs.length
  }
  return docs.filter(doc => {
    const createdMs = Date.parse(doc.created_at)
    return !Number.isNaN(createdMs) && createdMs > sinceMs
  }).length
}

export async function countUnreviewedIntakeUploads(
  admin: AdminClient,
  intakeId: string,
  uploadsReviewedAt?: string | null,
): Promise<number> {
  const since = uploadsReviewedAt ?? EPOCH_ISO
  const { count, error } = await admin
    .from('intake_documents')
    .select('id', { count: 'exact', head: true })
    .eq('client_intake_id', intakeId)
    .gt('created_at', since)

  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function countUnreviewedPortalUploads(
  admin: AdminClient,
  matterId: string,
  portalUploadsReviewedAt?: string | null,
): Promise<number> {
  const since = portalUploadsReviewedAt ?? EPOCH_ISO
  const { count, error } = await admin
    .from('matter_documents')
    .select('id', { count: 'exact', head: true })
    .eq('matter_id', matterId)
    .eq('folder', 'client')
    .gt('created_at', since)

  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function fetchUnreviewedUploadCounts(
  admin: AdminClient,
  matterId: string,
  intakeId: string | null | undefined,
  uploadsReviewedAt?: string | null,
  portalUploadsReviewedAt?: string | null,
): Promise<UnreviewedUploadCounts> {
  const [intake, portal] = await Promise.all([
    intakeId
      ? countUnreviewedIntakeUploads(admin, intakeId, uploadsReviewedAt)
      : Promise.resolve(0),
    countUnreviewedPortalUploads(admin, matterId, portalUploadsReviewedAt),
  ])
  return mergeUnreviewedCounts(intake, portal)
}

/** Batch unreviewed upload counts keyed by matter id. */
export async function fetchUnreviewedUploadCountsForMatters(
  admin: AdminClient,
  matterIds: string[],
): Promise<Map<string, UnreviewedUploadCounts>> {
  const result = new Map<string, UnreviewedUploadCounts>()
  if (!matterIds.length) return result

  const { data: matterRows, error: matterError } = await admin
    .from('matters')
    .select('id, client_intake_id, portal_uploads_reviewed_at')
    .in('id', matterIds)

  if (matterError) throw new Error(matterError.message)

  const intakeIds = [
    ...new Set(
      (matterRows ?? [])
        .map(row => row.client_intake_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ]

  for (const matterId of matterIds) {
    result.set(matterId, mergeUnreviewedCounts(0, 0))
  }

  const [{ data: intakes, error: intakeError }, { data: intakeDocs, error: intakeDocsError }, { data: portalDocs, error: portalDocsError }] =
    await Promise.all([
      intakeIds.length
        ? admin.from('client_intake').select('id, uploads_reviewed_at').in('id', intakeIds)
        : Promise.resolve({ data: [], error: null }),
      intakeIds.length
        ? admin
            .from('intake_documents')
            .select('client_intake_id, created_at')
            .in('client_intake_id', intakeIds)
        : Promise.resolve({ data: [], error: null }),
      admin
        .from('matter_documents')
        .select('matter_id, created_at')
        .in('matter_id', matterIds)
        .eq('folder', 'client'),
    ])

  if (intakeError) throw new Error(intakeError.message)
  if (intakeDocsError) throw new Error(intakeDocsError.message)
  if (portalDocsError) throw new Error(portalDocsError.message)

  const reviewedAtByIntake = new Map(
    (intakes ?? []).map(row => [row.id, row.uploads_reviewed_at as string | null]),
  )
  const intakeDocsByIntake = new Map<string, Array<{ created_at: string }>>()
  for (const doc of intakeDocs ?? []) {
    const list = intakeDocsByIntake.get(doc.client_intake_id) ?? []
    list.push({ created_at: doc.created_at })
    intakeDocsByIntake.set(doc.client_intake_id, list)
  }

  const portalDocsByMatter = new Map<string, Array<{ created_at: string }>>()
  for (const doc of portalDocs ?? []) {
    const list = portalDocsByMatter.get(doc.matter_id) ?? []
    list.push({ created_at: doc.created_at })
    portalDocsByMatter.set(doc.matter_id, list)
  }

  for (const matter of matterRows ?? []) {
    const intakeCount = matter.client_intake_id
      ? countUnreviewedFromDocuments(
          intakeDocsByIntake.get(matter.client_intake_id) ?? [],
          reviewedAtByIntake.get(matter.client_intake_id) ?? null,
        )
      : 0
    const portalCount = countUnreviewedFromDocuments(
      portalDocsByMatter.get(matter.id) ?? [],
      matter.portal_uploads_reviewed_at as string | null,
    )
    result.set(matter.id, mergeUnreviewedCounts(intakeCount, portalCount))
  }

  return result
}

export async function markIntakeUploadsReviewed(
  admin: AdminClient,
  intakeId: string,
): Promise<void> {
  const { error } = await admin
    .from('client_intake')
    .update({ uploads_reviewed_at: new Date().toISOString() })
    .eq('id', intakeId)

  if (error) throw new Error(error.message)
}

export async function markPortalUploadsReviewed(
  admin: AdminClient,
  matterId: string,
): Promise<void> {
  const { error } = await admin
    .from('matters')
    .update({ portal_uploads_reviewed_at: new Date().toISOString() })
    .eq('id', matterId)

  if (error) throw new Error(error.message)
}

export function formatUnreviewedUploadLabel(counts: UnreviewedUploadCounts): string {
  if (counts.total <= 0) return ''
  if (counts.intake > 0 && counts.portal > 0) {
    return `${counts.total} new uploads`
  }
  if (counts.portal > 0) {
    return `${counts.portal} portal upload${counts.portal === 1 ? '' : 's'}`
  }
  return `${counts.intake} intake upload${counts.intake === 1 ? '' : 's'}`
}

export function formatUnreviewedUploadDetail(counts: UnreviewedUploadCounts): string {
  const parts: string[] = []
  if (counts.intake > 0) {
    parts.push(`${counts.intake} intake questionnaire`)
  }
  if (counts.portal > 0) {
    parts.push(`${counts.portal} portal`)
  }
  return parts.join(' · ')
}
