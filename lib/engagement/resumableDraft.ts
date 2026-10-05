import type { SupabaseClient } from '@supabase/supabase-js'
import { isSupportedWorkspaceDefinition } from '@/components/engagement/workspaceState'

type ExistingAgreement = {
  id: string
  matter_id: string | null
  lead_id: string | null
  active_revision_id: string | null
}

/**
 * The open draft a "Draft engagement" click should resume, or null to start a
 * new one.
 *
 * Only a draft the workspace can actually open counts: one with an active
 * revision whose definition a master covers. An agreement left without a
 * revision (a create that failed partway) or seeded from a legacy definition
 * would otherwise be "resumed" straight into a 404 — the lead and the matter
 * share this so both pages resume the same draft.
 */
export async function findResumableEngagementDraft(
  admin: SupabaseClient,
  matterId: string,
): Promise<{ id: string } | null> {
  const { data } = await admin
    .from('engagement_agreements')
    .select('id, matter_id, lead_id, active_revision_id')
    .eq('matter_id', matterId)
    .in('status', ['draft', 'ready', 'failed'])
    .not('active_revision_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const existing = data as ExistingAgreement | null
  if (!existing?.active_revision_id) return null

  const { data: activeRevision } = await admin
    .from('engagement_agreement_revisions')
    .select('input_snapshot')
    .eq('agreement_id', existing.id)
    .eq('id', existing.active_revision_id)
    .maybeSingle()
  const snapshot = (activeRevision as { input_snapshot?: Record<string, unknown> | null } | null)?.input_snapshot
  if (!snapshot) return null
  return isSupportedWorkspaceDefinition({ matterId: existing.matter_id, leadId: existing.lead_id, ...snapshot })
    ? { id: existing.id }
    : null
}
