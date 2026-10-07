import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { RecordWorkIndicator } from '@/components/work/RecordWorkIndicator'
import { leadListName } from './LeadsTable'
import { LEAD_BOARD_COLUMNS, leadBoardColumn } from '@/lib/leads/board'
import type { LeadListRow } from '@/lib/leads/viewTypes'
import type { RecordWorkSummary } from '@/lib/work/recordSummary'
import { formatDateTime } from '@/lib/utils'

export function LeadsGrid({ leads, workSummaries = {} }: { leads: LeadListRow[]; workSummaries?: Record<string, RecordWorkSummary> }) {
  if (!leads.length) return <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">No leads match these filters.</p>
  return <ul aria-label="Leads grid" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
    {leads.map(lead => <li key={lead.id} className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-2"><Link href={`/admin/leads/${lead.id}`} className="font-semibold hover:underline">{leadListName(lead)}</Link><Badge variant="secondary">{LEAD_BOARD_COLUMNS.find(column => column.key === leadBoardColumn(lead))?.label}</Badge></div>
      <p className="text-xs text-muted-foreground">{lead.practice_area ?? 'Practice area not set'}</p>
      <RecordWorkIndicator summary={workSummaries[lead.id]} />
      <p className="text-xs text-muted-foreground">Last activity · {lead.last_activity_at ? formatDateTime(lead.last_activity_at) : 'Not recorded'}</p>
    </li>)}
  </ul>
}
