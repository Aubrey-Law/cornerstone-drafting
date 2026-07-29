'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import { engineStageLabel } from '@/lib/stage-engine/labels'
import { stageTaskProgress } from '@/lib/stage-engine/stageTaskProgress'
import type { StageTaskRow } from '@/lib/queries/stageTasks'
import { formatTaskDate } from '@/lib/tasks/types'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'

function dueTone(task: StageTaskRow): 'red' | 'amber' | 'muted' {
  const now = Date.now()
  if (task.hard_due_at && new Date(task.hard_due_at).getTime() <= now) return 'red'
  if (task.soft_due_at && new Date(task.soft_due_at).getTime() <= now) return 'amber'
  return 'muted'
}

const DUE_CLASS: Record<'red' | 'amber' | 'muted', string> = {
  red: 'text-red-strong',
  amber: 'text-amber-orange',
  muted: 'text-muted-foreground',
}

export function MatterEngineStageTaskCard({
  task,
  compact = false,
  onUpdated,
}: {
  task: StageTaskRow
  compact?: boolean
  onUpdated?: (task: StageTaskRow) => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const progress = stageTaskProgress(task)
  const tone = dueTone(task)

  async function patch(body: Record<string, unknown>) {
    setError(null)
    const res = await fetch(`/api/admin/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error ?? 'Update failed')
    onUpdated?.(json.task as StageTaskRow)
  }

  function toggleItem(index: number, done: boolean) {
    startTransition(async () => {
      try {
        await patch({ checklist_index: index, done })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Update failed')
      }
    })
  }

  function markDone() {
    startTransition(async () => {
      try {
        await patch({ status: 'done' })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Update failed')
      }
    })
  }

  if (task.status === 'done') return null

  return (
    <div className={cn('rounded-lg border border-border bg-card', compact ? 'p-3' : 'p-4')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            SLA task · {engineStageLabel(task.stage_key ?? '')}
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">{task.title}</p>
          {task.batch_tag && (
            <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px]">{task.batch_tag}</span>
          )}
        </div>
        <div className="text-right text-xs">
          <p className={cn('font-medium tabular-nums', DUE_CLASS[tone])}>
            {progress.done}/{progress.total}
          </p>
          {task.hard_due_at && (
            <p className={cn('mt-0.5', DUE_CLASS[tone])}>SLA {formatTaskDate(task.hard_due_at)}</p>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {task.task_type === 'checklist' && task.checklist.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {task.checklist.map((item, index) => (
            <li key={index} className="flex items-start gap-2 text-sm">
              <Checkbox
                id={`stage-task-${task.id}-${index}`}
                checked={item.done}
                disabled={pending}
                onCheckedChange={checked => toggleItem(index, checked === true)}
                className="mt-0.5"
              />
              <label
                htmlFor={`stage-task-${task.id}-${index}`}
                className={cn('leading-snug', item.done && 'text-muted-foreground line-through')}
              >
                {item.text}
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3">
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={markDone}>
            Mark complete
          </Button>
        </div>
      )}
    </div>
  )
}
