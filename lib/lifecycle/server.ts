import 'server-only'

import { resolveIntakeReviewFlags, type IntakeReadinessFlag } from '@/lib/intakeReadiness'
import { PIPELINE_MATTER_COLUMNS } from '@/lib/queries/matterCore'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { PipelineMatter } from '@/types/database'
import type { EngagementState } from '@/lib/lifecycle/matter'
import { isEsignConfigured } from '@/lib/esign/firma'
import { esignNativeEnabled } from '@/lib/esign/flags'
import { inflateDesignSheetRow } from '@/lib/designSheetPersistence'

/**
 * Whether the engagement requirement applies at all.
 *
 * It only makes sense where the firm signs engagement agreements through the
 * app: through Firma (its env vars) or through the native engine (the firm
 * setting). Reading only the Firma vars, as this once did, switched the
 * requirement off for a firm that had moved to native signing. The native read
 * fails closed, so a database hiccup here means the requirement does not
 * apply, never that it blocks.
 */
async function engagementTracked(): Promise<boolean> {
  if (isEsignConfigured()) return true
  try {
    return await esignNativeEnabled()
  } catch {
    return false
  }
}

export interface LoadedMatterLifecycleContext {
  matter: PipelineMatter
  engagement?: EngagementState
  reviewFlags: IntakeReadinessFlag[]
}

export interface MatterLifecycleEvidence {
  engagement?: EngagementState
  reviewFlags: IntakeReadinessFlag[]
  designStatus: string | null
}

export async function loadMatterLifecycleEvidenceBatch(
  matterIds: string[],
): Promise<Map<string, MatterLifecycleEvidence>> {
  const uniqueIds = [...new Set(matterIds.filter(Boolean))]
  if (uniqueIds.length === 0) return new Map()
  const admin = getAdminClient()
  const engagementQuery = (await engagementTracked())
    ? admin.from('matter_details')
        .select('client_id, engagement_signed, engagement_sent_at, engagement_status')
        .in('client_id', uniqueIds)
    : Promise.resolve({ data: [], error: null })
  const [engagementResult, designResult] = await Promise.all([
    engagementQuery,
    admin.from('design_sheets')
      .select('*')
      .in('matter_id', uniqueIds)
      .order('version', { ascending: false }),
  ])
  if (engagementResult.error) throw new Error(`Could not load engagement lifecycle: ${engagementResult.error.message}`)
  if (designResult.error) throw new Error(`Could not load design lifecycle: ${designResult.error.message}`)

  const engagementByMatter = new Map<string, EngagementState>()
  for (const row of engagementResult.data ?? []) {
    engagementByMatter.set(row.client_id, {
      signed: Boolean(row.engagement_signed),
      sentAt: row.engagement_sent_at ?? null,
      status: row.engagement_status ?? null,
    })
  }
  const designByMatter = new Map<string, Record<string, unknown>>()
  for (const row of (designResult.data ?? []) as Array<Record<string, unknown>>) {
    const matterId = typeof row.matter_id === 'string' ? row.matter_id : null
    if (matterId && !designByMatter.has(matterId)) designByMatter.set(matterId, row)
  }

  return new Map(uniqueIds.map(matterId => {
    const design = inflateDesignSheetRow(designByMatter.get(matterId) ?? null) as unknown as Record<string, unknown> | null
    const storedFlags = Array.isArray(design?.intake_review_flags)
      ? design.intake_review_flags as unknown as IntakeReadinessFlag[]
      : []
    return [matterId, {
      engagement: engagementByMatter.get(matterId),
      reviewFlags: resolveIntakeReviewFlags(storedFlags, design),
      designStatus: typeof design?.status === 'string' ? design.status : null,
    }]
  }))
}

/**
 * Loads exactly the sources the matter page uses for lifecycle decisions.
 * Stage validation and the assistant call this rather than rebuilding a
 * smaller, silently different picture of the same matter.
 */
export async function loadMatterLifecycleContext(
  matterId: string,
): Promise<LoadedMatterLifecycleContext | null> {
  const admin = getAdminClient()
  const [pipelineResult, engagementResult, designResult, tracked] = await Promise.all([
    admin.from('v_matter_pipeline').select(PIPELINE_MATTER_COLUMNS).eq('matter_id', matterId).maybeSingle(),
    admin.from('matter_details')
      .select('engagement_signed, engagement_sent_at, engagement_status')
      .eq('client_id', matterId)
      .maybeSingle(),
    admin.from('design_sheets')
      .select('*')
      .eq('matter_id', matterId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    engagementTracked(),
  ])

  if (pipelineResult.error) throw new Error(`Could not load lifecycle matter: ${pipelineResult.error.message}`)
  if (!pipelineResult.data) return null
  if (engagementResult.error) throw new Error(`Could not load engagement lifecycle: ${engagementResult.error.message}`)
  if (designResult.error) throw new Error(`Could not load design lifecycle: ${designResult.error.message}`)

  const design = inflateDesignSheetRow(
    designResult.data as Record<string, unknown> | null,
  ) as unknown as Record<string, unknown> | null
  const storedFlags = Array.isArray(design?.intake_review_flags)
    ? design.intake_review_flags as unknown as IntakeReadinessFlag[]
    : []
  const reviewFlags = resolveIntakeReviewFlags(storedFlags, design)
  const engagement = tracked && engagementResult.data
    ? {
        signed: Boolean(engagementResult.data.engagement_signed),
        sentAt: engagementResult.data.engagement_sent_at ?? null,
        status: engagementResult.data.engagement_status ?? null,
      }
    : undefined

  return {
    matter: {
      ...(pipelineResult.data as PipelineMatter),
      design_status: typeof design?.status === 'string'
        ? design.status
        : pipelineResult.data.design_status,
    },
    engagement,
    reviewFlags,
  }
}
