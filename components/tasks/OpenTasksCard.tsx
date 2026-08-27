import Link from 'next/link'
import { CheckCircle2, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  TASK_PRIORITY_LABEL,
  effectiveDueAt,
  formatTaskDue,
  isTaskOverdue,
  taskRecordHref,
  type TaskRow,
} from '@/lib/tasks/types'
import { cn } from '@/lib/utils'

const PRIORITY_TONE: Record<string, string> = {
  high: 'border-destructive/30 bg-red-bg text-destructive',
  normal: 'border-amber-border bg-amber-bg text-amber',
  low: 'border-border bg-muted text-muted-foreground',
}

export function OpenTasksCard({ tasks }: { tasks: TaskRow[] }) {
  return (
    <Card className="min-w-0 gap-0 py-0">
      <CardHeader className="flex-row items-start justify-between border-b border-border py-3">
        <div>
          <CardTitle className="text-sm">Tasks</CardTitle>
          <p className="text-xs text-muted-foreground">Open work across leads and matters</p>
        </div>
        <Button asChild variant="outline" size="sm" className="h-8 gap-1.5">
          <Link href="/admin/tasks">
            <Plus className="h-3.5 w-3.5" aria-hidden />
            All tasks
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-2 px-4 py-4">
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-green" aria-hidden />
            Nothing open right now.
          </div>
        ) : tasks.map(task => {
          const href = taskRecordHref(task)
          const overdue = isTaskOverdue(task)
          return (
            <div key={task.id} className="rounded-lg border border-border p-3">
              <p className="text-sm font-medium">
                {href ? (
                  <Link href={href} className="hover:text-primary hover:underline">
                    {task.title}
                  </Link>
                ) : task.title}
              </p>
              {(task.description || task.record_name) && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {task.description || task.record_name}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn('text-[10px]', PRIORITY_TONE[task.priority] ?? PRIORITY_TONE.low)}
                >
                  {TASK_PRIORITY_LABEL[task.priority]}
                </Badge>
                <span className={overdue ? 'text-xs font-medium text-destructive' : 'text-xs text-muted-foreground'}>
                  {formatTaskDue(effectiveDueAt(task)) || 'No due date'}
                </span>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
