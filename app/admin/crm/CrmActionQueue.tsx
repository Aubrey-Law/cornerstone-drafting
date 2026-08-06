import Link from 'next/link'
import { ArrowRight, BarChart3, CheckSquare, Clock3, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn, formatDateTime } from '@/lib/utils'
import { isTaskOverdue, type TaskRow } from '@/lib/tasks/types'
import type { CrmOperations } from '@/lib/queries/crmOperations'
import { AnnualReviewButton } from './AnnualReviewButton'

type CrmView = 'mine' | 'team' | 'unassigned' | 'overdue' | 'due-today' | 'leads' | 'clients'
const VIEW_LABELS: Record<CrmView, string> = {
  mine: 'Mine', team: 'Team', unassigned: 'Unassigned', overdue: 'Overdue', 'due-today': 'Due today', leads: 'Leads', clients: 'Clients',
}

export function CrmActionQueue({ tasks, operations, view }: { tasks: TaskRow[]; operations: CrmOperations; view: CrmView }) {
  const overdue = tasks.filter(task => isTaskOverdue(task)).length
  const dueToday = tasks.filter(task => !isTaskOverdue(task) && task.due_at?.slice(0, 10) === new Date().toISOString().slice(0, 10)).length
  const visibleTasks = tasks.filter(task => {
    if (view === 'overdue') return isTaskOverdue(task)
    if (view === 'due-today') return !isTaskOverdue(task) && task.due_at?.slice(0, 10) === new Date().toISOString().slice(0, 10)
    if (view === 'leads') return Boolean(task.lead_id)
    if (view === 'clients') return Boolean(task.matter_id)
    return true
  })
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Cornerstone CRM</p>
          <h1 className="text-2xl font-semibold tracking-tight">My action queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">Live work from leads, matters, and the existing task engine.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/admin/crm/people">People</Link></Button>
          <Button asChild><Link href="/admin/tasks">Open tasks <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(VIEW_LABELS) as CrmView[]).map(nextView => (
          <Button key={nextView} asChild size="sm" variant={view === nextView ? 'default' : 'outline'}>
            <Link href={nextView === 'mine' ? '/admin/crm' : `/admin/crm?view=${nextView}`}>{VIEW_LABELS[nextView]}</Link>
          </Button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Open work</p><p className="mt-1 text-2xl font-semibold">{tasks.length}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Overdue</p><p className="mt-1 text-2xl font-semibold text-destructive">{overdue}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Due today</p><p className="mt-1 text-2xl font-semibold">{dueToday}</p></CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0"><BarChart3 className="h-5 w-5 text-primary" /><CardTitle className="text-base">Lead conversion</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><p className="text-muted-foreground">Leads</p><p className="text-xl font-semibold">{operations.leads}</p></div>
            <div><p className="text-muted-foreground">Consultations</p><p className="text-xl font-semibold">{operations.consultationsBooked}</p></div>
            <div><p className="text-muted-foreground">Retained</p><p className="text-xl font-semibold">{operations.retained}</p></div>
            <div><p className="text-muted-foreground">Conversion</p><p className="text-xl font-semibold">{operations.conversionRate}%</p></div>
            <div className="col-span-2 sm:col-span-4"><p className="mb-1 text-muted-foreground">Top lead sources</p>{operations.sources.length ? operations.sources.map(source => <p key={source.source}>{source.source}: {source.leads} leads</p>) : <p>No source data yet.</p>}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0"><UsersRound className="h-5 w-5 text-primary" /><CardTitle className="text-base">Annual client reviews</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {operations.annualReviewCandidates.map(candidate => <div key={candidate.matterId} className="flex items-center justify-between gap-3 rounded border p-2 text-sm"><Link className="min-w-0 truncate font-medium hover:underline" href={`/admin/matters/${candidate.matterId}`}>{candidate.clientName}</Link><AnnualReviewButton matterId={candidate.matterId} /></div>)}
            {!operations.annualReviewCandidates.length && <p className="text-sm text-muted-foreground">All retained clients shown already have an open annual-review task.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <CheckSquare className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Next actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {visibleTasks.slice(0, 30).map(task => {
            const href = task.matter_id ? `/admin/matters/${task.matter_id}` : task.lead_id ? `/admin/leads/${task.lead_id}` : '/admin/tasks'
            const overdueTask = isTaskOverdue(task)
            return (
              <Link key={task.id} href={href} className="flex items-center justify-between gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50">
                <div className="min-w-0">
                  <p className="truncate font-medium">{task.title}</p>
                  <p className="truncate text-sm text-muted-foreground">{task.record_name ?? 'Firm task'}{task.assignee_name ? ` · ${task.assignee_name}` : ''}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {task.due_at && <span className={cn('hidden text-xs sm:inline', overdueTask && 'font-medium text-destructive')}><Clock3 className="mr-1 inline h-3 w-3" />{formatDateTime(task.due_at)}</span>}
                  {overdueTask && <Badge variant="destructive">Overdue</Badge>}
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            )
          })}
          {!visibleTasks.length && <p className="py-8 text-center text-sm text-muted-foreground">No open actions match this view.</p>}
        </CardContent>
      </Card>
    </div>
  )
}
