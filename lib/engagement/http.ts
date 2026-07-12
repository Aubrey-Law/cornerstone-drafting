import { getCachedClaims, getCachedUserRole } from '@/lib/supabaseServer'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isSupportedWorkspaceDefinition } from '@/components/engagement/workspaceState'

export async function requireEngagementStaff() {
  const auth = await getCachedClaims()
  if (!auth) throw new Error('Unauthorized')
  const role = await getCachedUserRole(auth.id)
  if (!role || !['attorney', 'admin'].includes(role)) throw new Error('Forbidden')
  return auth
}

export async function getScopedAgreement(id: string) {
  const { data } = await getAdminClient().from('engagement_agreements').select('*, active_revision:engagement_agreement_revisions!active_revision_id(*), recipients:engagement_agreement_recipients(*)').eq('id', id).maybeSingle()
  const snapshot = (data as any)?.active_revision?.input_snapshot
  if (!data || !snapshot || !isSupportedWorkspaceDefinition({ matterId:data.matter_id, leadId:data.lead_id, ...snapshot })) throw new Error('Engagement agreement not found or unavailable')
  return data as any
}

export function engagementHttpError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Request failed'
  const status = message === 'Unauthorized' ? 401 : message === 'Forbidden' ? 403 : /not found|unavailable/i.test(message) ? 404 : 400
  return Response.json({ error: message }, { status })
}
