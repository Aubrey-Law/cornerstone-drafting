import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { getAdminClient } from '@/lib/supabaseAdmin'

export interface TaskRecordOption {
  id: string
  name: string
  kind: 'matter' | 'lead'
  detail: string | null
}

/**
 * Records a task can hang off, for the composer's `@` picker. Matters come from
 * the hired pipeline; leads are intake records, which is what `/admin/leads/[id]`
 * addresses.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin(req)
  if (auth.err) return auth.err

  const query = (new URL(req.url).searchParams.get('q') ?? '').trim().replace(/[%,()]/g, ' ')
  const admin = getAdminClient()

  const matterFilter = query
    ? `matter_name.ilike.%${query}%,client_name.ilike.%${query}%,matter_number.ilike.%${query}%`
    : null
  const leadFilter = query
    ? `full_name.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%`
    : null

  const mattersQuery = admin
    // Client names are derived by the pipeline view from the linked intake;
    // they are not columns on `matters`. The consolidated view retains the
    // matter number for a useful search target while this filter keeps the
    // picker limited to hired matters.
    .from('v_matter_pipeline_all')
    .select('matter_id, matter_name, client_name, stage')
    .eq('relationship_status', 'hired')
    .order('matter_created', { ascending: false })
    .limit(8)

  const leadsQuery = admin
    .from('client_intake')
    .select('id, full_name, first_name, last_name, email')
    .not('lead_status', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(8)

  const [matters, leads] = await Promise.all([
    matterFilter ? mattersQuery.or(matterFilter) : mattersQuery,
    leadFilter ? leadsQuery.or(leadFilter) : leadsQuery,
  ])

  if (matters.error) console.error('task records matters:', matters.error.message)
  if (leads.error) console.error('task records leads:', leads.error.message)

  const options: TaskRecordOption[] = [
    ...((matters.data ?? []) as Array<{ matter_id: string; matter_name: string | null; client_name: string | null; stage: string | null }>)
      .map(m => ({
        id: m.matter_id,
        name: m.client_name?.trim() || m.matter_name?.trim() || 'Unnamed matter',
        kind: 'matter' as const,
        detail: m.stage,
      })),
    ...((leads.data ?? []) as Array<Record<string, string | null>>).map(l => ({
      id: l.id as string,
      name: l.full_name?.trim()
        || [l.first_name, l.last_name].filter(Boolean).join(' ').trim()
        || l.email
        || 'Unnamed lead',
      kind: 'lead' as const,
      detail: l.email,
    })),
  ]

  return NextResponse.json({ records: options })
}
