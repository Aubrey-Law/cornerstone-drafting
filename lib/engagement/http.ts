import { getCachedClaims, getCachedUserRole } from '@/lib/supabaseServer'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isSupportedWorkspaceDefinition } from '@/components/engagement/workspaceState'
import { getAgreement } from './repository'

type EngagementSnapshot = {
  practiceArea?: string
  clientMode?: string
  scopeKey?: string
  legalPlan?: unknown
}

type ScopedAgreement = {
  matter_id?: string | null
  lead_id?: string | null
  active_revision?: { input_snapshot?: EngagementSnapshot | null } | null
}

export async function requireEngagementStaff() {
  const auth = await getCachedClaims()
  if (!auth) throw new Error('Unauthorized')
  const role = await getCachedUserRole(auth.id)
  if (!role || !['attorney', 'admin'].includes(role)) throw new Error('Forbidden')
  return auth
}

export async function getScopedAgreement(id: string) {
  const data = await getAgreement(getAdminClient(), id) as ScopedAgreement
  const snapshot = data.active_revision?.input_snapshot
  if (!data || !snapshot || !isSupportedWorkspaceDefinition({ matterId:data.matter_id, leadId:data.lead_id, ...snapshot })) throw new Error('Engagement agreement not found or unavailable')
  return data
}

export function engagementHttpError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Request failed'
  const status = message === 'Unauthorized' ? 401 : message === 'Forbidden' ? 403 : /not found|unavailable/i.test(message) ? 404 : 400
  return Response.json({ error: message }, { status })
}
