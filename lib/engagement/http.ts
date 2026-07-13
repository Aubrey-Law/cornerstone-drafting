import { getCachedClaims, getCachedUserRole } from '@/lib/supabaseServer'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { isSupportedWorkspaceDefinition } from '@/components/engagement/workspaceState'
import { getAgreement } from './repository'
import type { EngagementInput } from './types'

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

export type EngagementWorkspaceAgreement = {
  id: string
  matter_id?: string | null
  lead_id?: string | null
  status: string
  active_revision: {
    id: string
    render_sha256: string
    input_snapshot: EngagementInput
    render_snapshot?: { docxBase64?: string; pdfBase64?: string } | null
  }
  recipients: Array<{
    id?: string
    name: string
    email?: string
    status: string
    recipient_order?: number
    role?: string
  }>
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
  return data as EngagementWorkspaceAgreement
}

export function engagementHttpError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Request failed'
  const status = message === 'Unauthorized' ? 401 : message === 'Forbidden' ? 403 : /not found|unavailable/i.test(message) ? 404 : 400
  return Response.json({ error: message }, { status })
}
