import type { CrmDashboardSnapshot } from '@/lib/crm/dashboard'
import type { MatterDashboardSnapshot, MatterTotal } from '@/lib/matters/dashboard'
import type { MatterAgingTiles } from '@/lib/queries/pipelineAging'
import type { TaskCounts } from '@/lib/tasks/types'

/**
 * The firm dashboard is one reading of the book, not a second copy of the
 * matters, leads, and tasks pages. Those pages still own the lists; this
 * snapshot only decides which counts belong on the front and in what order.
 */

export interface FirmMetric {
  key: string
  label: string
  /** Null when the read failed. A failed read is not a zero. */
  value: number | null
  caption: string
  href: string
  attention: boolean
}

export interface FirmAttentionItem {
  key: string
  label: string
  detail: string
  count: number
  href: string
}

export interface FirmDashboardSnapshot {
  metrics: FirmMetric[]
  /** Non-zero pressure, most urgent first. An empty list is a clear queue. */
  attention: FirmAttentionItem[]
  tasksUnavailable: boolean
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

function counted(count: number, label: string): string {
  return `${count.toLocaleString('en-US')} ${label}`
}

function openedThisMonth(total: MatterTotal): string {
  if (total.deltaPercent === null) return `${plural(total.newThisMonth, 'matter')} opened this month`
  const sign = total.deltaPercent >= 0 ? '+' : ''
  return `${sign}${total.deltaPercent}% from last month`
}

export function buildFirmDashboard(input: {
  tasks: TaskCounts | null
  matters: MatterDashboardSnapshot
  aging: MatterAgingTiles
  crm: CrmDashboardSnapshot
}): FirmDashboardSnapshot {
  const { tasks, matters, aging, crm } = input
  const tasksUnavailable = tasks === null

  const metrics: FirmMetric[] = [
    {
      key: 'open-matters',
      label: 'Open matters',
      value: matters.open.count,
      caption: openedThisMonth(matters.open),
      href: '/admin/matters/list',
      attention: false,
    },
    {
      key: 'active-leads',
      label: 'Active leads',
      value: crm.activePipeline.count,
      caption: `${crm.conversion.percent}% of leads converted`,
      href: '/admin/crm/opportunities',
      attention: false,
    },
    {
      key: 'open-tasks',
      label: 'Open tasks',
      value: tasks?.open ?? null,
      caption: tasks ? counted(tasks.today, 'due today') : 'Task counts are unavailable',
      href: '/admin/tasks',
      attention: false,
    },
    {
      key: 'needs-attention',
      label: 'Needs attention',
      value: matters.needsAttention,
      caption: 'Critical, Must do, and Soon',
      href: '/admin/matters/list?card=attention',
      attention: matters.needsAttention > 0,
    },
    {
      key: 'overdue-tasks',
      label: 'Overdue tasks',
      value: tasks?.overdue ?? null,
      caption: tasks ? counted(tasks.unassigned, 'unassigned') : 'Task counts are unavailable',
      href: '/admin/tasks?group=due',
      attention: (tasks?.overdue ?? 0) > 0,
    },
    {
      key: 'follow-ups',
      label: 'Follow-ups overdue',
      value: crm.followUps.overdue,
      caption: `${counted(crm.followUps.dueToday, 'due today')} · ${counted(crm.followUps.upcoming, 'upcoming')}`,
      href: '/admin/crm/activities',
      attention: crm.followUps.overdue > 0,
    },
  ]

  const attention: FirmAttentionItem[] = []
  const add = (item: FirmAttentionItem) => {
    if (item.count > 0) attention.push(item)
  }

  if (tasks) {
    add({
      key: 'overdue-tasks',
      label: 'Overdue tasks',
      detail: 'Open firm tasks past their due date',
      count: tasks.overdue,
      href: '/admin/tasks?group=due',
    })
    add({
      key: 'tasks-today',
      label: 'Tasks due today',
      detail: 'Due before the end of the firm day',
      count: tasks.today,
      href: '/admin/tasks?group=due',
    })
    add({
      key: 'unassigned-tasks',
      label: 'Unassigned tasks',
      detail: 'Open tasks with nobody named',
      count: tasks.unassigned,
      href: '/admin/tasks?scope=unassigned',
    })
  }

  add({
    key: 'follow-ups-overdue',
    label: 'Follow-ups overdue',
    detail: 'Contacts whose next follow-up date has passed',
    count: crm.followUps.overdue,
    href: '/admin/crm/activities',
  })
  add({
    key: 'follow-ups-today',
    label: 'Follow-ups due today',
    detail: 'Contacts due for a follow-up today',
    count: crm.followUps.dueToday,
    href: '/admin/crm/activities',
  })
  add({
    key: 'needs-attention',
    label: 'Matters that need a move',
    detail: 'Critical, Must do, or Soon work on an open matter',
    count: matters.needsAttention,
    href: '/admin/matters/list?card=attention',
  })
  add({
    key: 'signing-soon',
    label: 'Signings in the next 30 days',
    detail: 'Open matters with a signing date inside the window',
    count: matters.signingSoon,
    href: '/admin/matters/list?card=signing',
  })
  add({
    key: 'awaiting-intake',
    label: 'Intake not submitted',
    detail: 'Open matters still waiting on the questionnaire',
    count: matters.awaitingIntake,
    href: '/admin/matters/list',
  })
  add({
    key: 'aging-red',
    label: 'Past the stage budget',
    detail: aging.amber > 0
      ? `${plural(aging.amber, 'record')} close to the budget`
      : 'Red on the aging board',
    count: aging.red,
    href: '/admin/pipeline/aging',
  })

  return { metrics, attention, tasksUnavailable }
}
