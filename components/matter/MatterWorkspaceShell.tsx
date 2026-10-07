import { notFound } from 'next/navigation'
import { requireStaffPage } from '@/lib/review/staff'
import { fetchMatter } from '@/lib/queries/matterCore'
import { stageLabel } from '@/types/database'
import { fetchWorkGraphForUser } from '@/lib/work/server'
import { buildRecordWorkSummaries } from '@/lib/work/recordSummary'
import { RecordWorkIndicator } from '@/components/work/RecordWorkIndicator'
import { MatterWorkspaceNav } from './MatterWorkspaceNav'
import { normalizePracticeArea } from '@/lib/practiceArea'

export async function MatterWorkspaceShell({ matterId, active, children }: { matterId: string; active: string; children?: React.ReactNode }) {
  const { userId } = await requireStaffPage()
  if (!/^[0-9a-f-]{36}$/i.test(matterId)) notFound()
  const [matter, graph] = await Promise.all([fetchMatter(matterId), fetchWorkGraphForUser(userId)])
  if (!matter) notFound()
  const practice = normalizePracticeArea(matter.practice_area)
  return <div className={children ? "flex h-full min-h-0 min-w-0 flex-col gap-4" : "min-w-0"}>
    <header className="shrink-0 rounded-lg border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h1 className="text-xl font-semibold">{matter.client_name || matter.matter_name || 'Matter'}</h1><span className="text-sm text-muted-foreground">{stageLabel(matter.stage)}</span></div>
      <RecordWorkIndicator summary={buildRecordWorkSummaries(graph.items, 'matter')[matterId]} />
      <MatterWorkspaceNav matterId={matterId} active={active} drafting={practice !== 'Probate' && practice !== 'TA'} />
    </header>
    {children && <div className="min-h-0 flex-1 overflow-auto">{children}</div>}
  </div>
}
