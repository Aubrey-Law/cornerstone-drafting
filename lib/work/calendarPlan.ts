import type { DailyPlanStatus, StoredDailyPlan } from '@/lib/work/plans'
import type { DailyPlanPreview, PlanLane, PriorityBand, WorkItem, WorkState } from '@/lib/work/types'

export interface CalendarPlanItem {
  workKey: string
  title: string
  href: string
  recordName: string
  priorityBand: PriorityBand
  priorityReasons: string[]
  estimateMinutes: number
  lane: Exclude<PlanLane, 'later'>
  blockStart: string | null
  blockEnd: string | null
  state: WorkState
  itemStatus: 'planned' | 'started' | 'completed' | 'skipped'
  itemCount: number
}

export interface CalendarTodayPlan {
  date: string
  status: DailyPlanStatus | 'uncommitted'
  capacityMinutes: number
  plannedMinutes: number
  overload: boolean
  overloadMinutes: number
  items: CalendarPlanItem[]
}

function communicationBatch(input: {
  items: WorkItem[]
  lane: 'communication'
  blockStart: string | null
  blockEnd: string | null
  itemStatus?: CalendarPlanItem['itemStatus']
}): CalendarPlanItem | null {
  if (!input.items.length) return null
  const blockMinutes = input.blockStart && input.blockEnd
    ? Math.max(0, Math.round((Date.parse(input.blockEnd) - Date.parse(input.blockStart)) / 60_000))
    : 0
  const estimateMinutes = blockMinutes || input.items.reduce((sum, item) => sum + item.estimateMinutes, 0)
  return {
    workKey: 'batch:communications',
    title: `Communication batch (${input.items.length})`,
    href: '/admin/communications',
    recordName: 'Firm communications',
    priorityBand: Math.min(...input.items.map(item => item.priorityBand)) as PriorityBand,
    priorityReasons: ['Client replies grouped into one bounded batch'],
    estimateMinutes,
    lane: input.lane,
    blockStart: input.blockStart,
    blockEnd: input.blockEnd,
    state: 'open',
    itemStatus: input.itemStatus ?? 'planned',
    itemCount: input.items.length,
  }
}

function fromWorkItem(
  item: WorkItem,
  lane: Exclude<PlanLane, 'later'>,
  blockStart: string | null,
  blockEnd: string | null,
  itemStatus: CalendarPlanItem['itemStatus'] = 'planned',
): CalendarPlanItem {
  return {
    workKey: item.workKey,
    title: item.title,
    href: item.href,
    recordName: item.record.name,
    priorityBand: item.priorityBand,
    priorityReasons: item.priorityReasons.slice(0, 2).map(reason => reason.label),
    estimateMinutes: item.estimateMinutes,
    lane,
    blockStart,
    blockEnd,
    state: item.state,
    itemStatus,
    itemCount: 1,
  }
}

/** Present the same saved plan on Calendar that Today committed. */
export function buildCalendarTodayPlan(input: {
  items: WorkItem[]
  preview: DailyPlanPreview
  stored: StoredDailyPlan | null
}): CalendarTodayPlan {
  const byKey = new Map(input.items.map(item => [item.workKey, item]))
  const previewBlocks = new Map(input.preview.blocks.map(block => [block.workKey, block]))

  if (!input.stored) {
    const regular = [
      ...input.preview.mustDo.map(item => ({ lane: 'must_do' as const, item })),
      ...input.preview.suggested.map(item => ({ lane: 'suggested' as const, item })),
    ].map(({ lane, item }) => {
      const block = previewBlocks.get(item.workKey)
      return fromWorkItem(item, lane, block?.startAt ?? null, block?.endAt ?? null)
    })
    const batchBlock = previewBlocks.get('batch:communications')
    const batch = communicationBatch({
      items: input.preview.communication,
      lane: 'communication',
      blockStart: batchBlock?.startAt ?? null,
      blockEnd: batchBlock?.endAt ?? null,
    })
    const items = [...regular]
    if (batch) {
      const insertion = input.preview.mustDo.length
      items.splice(insertion, 0, batch)
    }
    return {
      date: input.preview.date,
      status: 'uncommitted',
      capacityMinutes: input.preview.capacityMinutes,
      plannedMinutes: input.preview.plannedMinutes,
      overload: input.preview.overload,
      overloadMinutes: input.preview.overloadMinutes,
      items,
    }
  }

  const visibleRows = input.stored.items.filter(row => row.lane !== 'later' && row.status !== 'skipped')
  const communicationRows = visibleRows.filter(row => row.lane === 'communication')
  const communicationItems = communicationRows.flatMap(row => {
    const item = byKey.get(row.work_key)
    return item ? [item] : []
  })
  const batchRow = communicationRows[0]
  const batchBlock = previewBlocks.get('batch:communications')
  const batch = communicationBatch({
    items: communicationItems,
    lane: 'communication',
    blockStart: batchRow?.block_start ?? batchBlock?.startAt ?? null,
    blockEnd: batchRow?.block_end ?? batchBlock?.endAt ?? null,
    itemStatus: communicationRows.every(row => row.status === 'completed')
      ? 'completed'
      : communicationRows.some(row => row.status === 'started')
        ? 'started'
        : 'planned',
  })

  const presented: CalendarPlanItem[] = []
  let insertedBatch = false
  for (const row of visibleRows) {
    if (row.lane === 'later') continue
    if (row.lane === 'communication') {
      if (!insertedBatch && batch) presented.push(batch)
      insertedBatch = true
      continue
    }
    const item = byKey.get(row.work_key)
    if (!item) {
      if (row.status !== 'completed') {
        presented.push({
          workKey: row.work_key,
          title: 'Committed work is temporarily unavailable',
          href: '/admin',
          recordName: 'Open Today to review this commitment',
          priorityBand: row.priority_band,
          priorityReasons: ['Its source is unavailable or changed since the plan was committed'],
          estimateMinutes: row.estimate_minutes,
          lane: row.lane,
          blockStart: row.block_start,
          blockEnd: row.block_end,
          state: 'blocked',
          itemStatus: row.status,
          itemCount: 1,
        })
      }
      continue
    }
    presented.push(fromWorkItem(
      item,
      row.lane,
      row.block_start,
      row.block_end,
      row.status,
    ))
  }

  const overloadMinutes = Math.max(0, input.stored.planned_minutes - input.stored.capacity_minutes)
  return {
    date: input.stored.plan_date,
    status: input.stored.status,
    capacityMinutes: input.stored.capacity_minutes,
    plannedMinutes: input.stored.planned_minutes,
    overload: input.preview.overload || overloadMinutes > 0,
    overloadMinutes: Math.max(input.preview.overloadMinutes, overloadMinutes),
    items: presented,
  }
}
