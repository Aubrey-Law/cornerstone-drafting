import { getAdminClient } from '@/lib/supabaseAdmin'

export type CrmSourceMetric = { source: string; leads: number; retained: number }
export type AnnualReviewCandidate = { matterId: string; clientName: string; hiredAt: string | null }

export type CrmOperations = {
  leads: number
  consultationsBooked: number
  retained: number
  conversionRate: number
  sources: CrmSourceMetric[]
  annualReviewCandidates: AnnualReviewCandidate[]
}

type IntakeRow = { id: string; lead_source: string | null }
type MatterRow = {
  id: string
  client_name: string | null
  relationship_status: string | null
  hired_at: string | null
  discovery_call_at: string | null
}

export async function fetchCrmOperations(): Promise<CrmOperations> {
  const admin = getAdminClient()
  const [{ data: intakes }, { data: matters }, { data: reviewTasks }] = await Promise.all([
    admin.from('client_intake').select('id, lead_source').not('lead_status', 'is', null).limit(5000),
    admin.from('matters').select('id, client_name, relationship_status, hired_at, discovery_call_at').limit(5000),
    admin.from('tasks').select('matter_id, status, title').ilike('title', 'Annual estate plan review').limit(5000),
  ])

  const intakeRows = (intakes ?? []) as IntakeRow[]
  const matterRows = (matters ?? []) as MatterRow[]
  const retainedMatters = matterRows.filter(matter => matter.relationship_status === 'hired')
  const sourceCounts = new Map<string, CrmSourceMetric>()
  for (const intake of intakeRows) {
    const source = intake.lead_source?.trim() || 'Unattributed'
    const current = sourceCounts.get(source) ?? { source, leads: 0, retained: 0 }
    current.leads += 1
    sourceCounts.set(source, current)
  }

  const activeReviewMatterIds = new Set(
    (reviewTasks ?? [])
      .filter(task => task.matter_id && ['open', 'in_progress', 'blocked'].includes(task.status ?? ''))
      .map(task => task.matter_id as string),
  )

  return {
    leads: intakeRows.length,
    consultationsBooked: matterRows.filter(matter => Boolean(matter.discovery_call_at)).length,
    retained: retainedMatters.length,
    conversionRate: intakeRows.length ? Math.round((retainedMatters.length / intakeRows.length) * 100) : 0,
    sources: [...sourceCounts.values()].sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source)).slice(0, 6),
    annualReviewCandidates: retainedMatters
      .filter(matter => !activeReviewMatterIds.has(matter.id))
      .sort((a, b) => (a.hired_at ?? '').localeCompare(b.hired_at ?? ''))
      .slice(0, 8)
      .map(matter => ({ matterId: matter.id, clientName: matter.client_name || 'Client matter', hiredAt: matter.hired_at })),
  }
}
