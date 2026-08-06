import Link from 'next/link'
import { ArrowRight, CheckSquare, Clock3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn, formatDateTime } from '@/lib/utils'
import { isTaskOverdue, type TaskRow } from '@/lib/tasks/types'

export function CrmActionQueue({ tasks }: { tasks: TaskRow[] }) {
  const overdue = tasks.filter(task => isTaskOverdue(task)).length
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

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Open work</p><p className="mt-1 text-2xl font-semibold">{tasks.length}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Overdue</p><p className="mt-1 text-2xl font-semibold text-destructive">{overdue}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Due next</p><p className="mt-1 text-2xl font-semibold">{Math.max(0, tasks.length - overdue)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <CheckSquare className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Next actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tasks.slice(0, 30).map(task => {
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
          {!tasks.length && <p className="py-8 text-center text-sm text-muted-foreground">No open actions assigned to you.</p>}
        </CardContent>
      </Card>
    </div>
  )
}
