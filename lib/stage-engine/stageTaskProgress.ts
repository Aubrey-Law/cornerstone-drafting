import type { StageTaskRow } from '@/lib/queries/stageTasks'

export function stageTaskProgress(task: Pick<StageTaskRow, 'task_type' | 'status' | 'checklist'>): {
  done: number
  total: number
  isComplete: boolean
} {
  if (task.status === 'done') {
    if (task.task_type === 'checklist' && task.checklist.length > 0) {
      return { done: task.checklist.length, total: task.checklist.length, isComplete: true }
    }
    return { done: 1, total: 1, isComplete: true }
  }

  if (task.task_type === 'checklist') {
    const total = task.checklist.length
    const done = task.checklist.filter(item => item.done).length
    return { done, total: Math.max(total, 1), isComplete: total > 0 && done === total }
  }

  return { done: 0, total: 1, isComplete: false }
}
