import { parseRecurrence } from '@/lib/tasks/recurrence'
import {
  TASK_PRIORITIES,
  type ChecklistItem,
  type TaskPriority,
  type TaskRecurrence,
} from '@/lib/tasks/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface TaskTemplateItem {
  text: string
  description?: string | null
  offset_days?: number
  priority?: TaskPriority
  assignee_id?: string | null
  estimate_minutes?: number | null
  recurrence?: TaskRecurrence | null
  checklist?: ChecklistItem[]
}

function normalizeChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (typeof item === 'string') return item.trim() ? [{ text: item.trim(), done: false }] : []
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    return typeof raw.text === 'string' && raw.text.trim()
      ? [{ text: raw.text.trim(), done: false }]
      : []
  })
}

export function normalizeTemplateItems(value: unknown): TaskTemplateItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const raw = (typeof item === 'object' && item ? item : {}) as Record<string, unknown>
    const text = typeof item === 'string' ? item : typeof raw.text === 'string' ? raw.text : ''
    if (!text.trim()) return []

    const offset = Number(raw.offset_days)
    const estimate = Number(raw.estimate_minutes)
    return [{
      text: text.trim(),
      description: typeof raw.description === 'string' && raw.description.trim()
        ? raw.description.trim()
        : null,
      offset_days: Number.isFinite(offset) && offset >= 0 ? Math.round(offset) : 0,
      priority: TASK_PRIORITIES.includes(raw.priority as TaskPriority)
        ? (raw.priority as TaskPriority)
        : 'normal',
      assignee_id: typeof raw.assignee_id === 'string' && UUID_RE.test(raw.assignee_id)
        ? raw.assignee_id
        : null,
      estimate_minutes: Number.isFinite(estimate) && estimate > 0 ? Math.round(estimate) : null,
      recurrence: parseRecurrence(raw.recurrence),
      checklist: normalizeChecklist(raw.checklist),
    }]
  })
}
