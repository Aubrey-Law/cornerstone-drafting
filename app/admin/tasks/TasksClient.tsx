'use client'
import { TaskPresentationSwitch, TaskPresentationView, useTaskPresentation } from '@/components/tasks/TaskPresentation'

import { usePrimaryReady } from '@/app/admin/components/NavigationTiming'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ChevronDown,
  ChevronRight,
  Layers,
  ListTodo,
  PauseCircle,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { FIRM_TIMEZONE } from '@/lib/firmDate'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  TASK_SOURCES,
  TASK_SOURCE_LABEL,
  compareTasks,
  groupTasksByRecord,
  taskDueGroup,
  type TaskPriority,
  type TaskRow,
  type TaskSource,
  type TaskDueGroup,
} from '@/lib/tasks/types'
import { TaskComposer, type TaskComposerHandle } from '@/components/tasks/TaskComposer'
import { TaskListRow } from '@/components/tasks/TaskPrimitives'
import { useTaskActions } from '@/components/tasks/useTaskActions'
import { OPEN_TASK_CAPTURE_EVENT } from '@/components/tasks/taskEvents'
import { TaskTemplateSheet, type TaskTemplate } from '@/components/tasks/TaskTemplateSheet'
import { TaskDetailSheet } from '@/components/tasks/TaskDetailSheet'
import {
  compareTasksByWorkSummary,
  type TaskWorkSummaries,
} from '@/lib/work/taskSummary'

import type { TaskPageGroup, TaskPageParams } from '@/lib/tasks/pageParams'

type ScopeKey = 'mine' | 'team' | 'unassigned'

type GroupKey = TaskPageGroup

type PriorityGroupKey = 'critical' | 'today' | 'soon' | 'planned' | 'waiting'

const EMPTY_WORK_SUMMARIES: TaskWorkSummaries = {}

interface Assignee {
  id: string
  name: string
}

interface TasksClientProps {
  initialOpenTasks: TaskRow[]
  initialDoneToday: TaskRow[]
  assignees: Assignee[]
  templates: TaskTemplate[]
  viewerId: string | null
  workSummaries?: TaskWorkSummaries
  pagination?: { params: TaskPageParams; total: number; pageCount?: number; doneTotal: number; scopeCounts: Record<ScopeKey, number> }
}

const TODAY_LABEL = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: FIRM_TIMEZONE,
})

type BulkAction = 'assign' | 'snooze' | 'delete'

const SNOOZE_OPTIONS = [
  { label: 'Tomorrow', days: 1 },
  { label: '3 days', days: 3 },
  { label: 'Next week', days: 7 },
]

function GroupShell({
  title,
  count,
  accent = false,
  children,
}: {
  title: string
  count: number
  accent?: boolean
  children: React.ReactNode
}) {
  if (count === 0) return null
  const headingId = `task-group-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
  return (
    <section>
      <div className="flex items-center gap-2 px-1 pb-1 pt-3">
        <h2 id={headingId} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        <Badge
          variant="secondary"
          className={cn('text-micro tabular-nums', accent && 'border-transparent bg-red-bg text-red')}
        >
          {count}
        </Badge>
      </div>
      <ul
        aria-labelledby={headingId}
        className={cn(
          'divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sm',
          accent && 'border-l-[3px] border-l-destructive',
        )}
      >
        {children}
      </ul>
    </section>
  )
}

function CollapsedGroup({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string
  count: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <section className="mt-3">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {open ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
          <span>{title}</span>
          <span className="tabular-nums">· {count}</span>
        </button>
        {open && <ul className="divide-y divide-border border-t border-border">{children}</ul>}
      </div>
    </section>
  )
}

export function TasksClient({
  initialOpenTasks,
  initialDoneToday,
  assignees,
  templates,
  viewerId,
  workSummaries = EMPTY_WORK_SUMMARIES,
  pagination,
}: TasksClientProps) {
  usePrimaryReady('Tasks')
  const router = useRouter()
  const searchParams = useSearchParams()
  const navigate = (changes: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString())
    next.set('page', '1'); next.set('donePage', '1')
    for (const [key, value] of Object.entries(changes)) next.set(key, value)
    router.push(`/admin/tasks?${next}`)
  }
  const [openTasks, setOpenTasks] = useState(initialOpenTasks)
  const [doneToday, setDoneToday] = useState(initialDoneToday)
  const [localScope, setScope] = useState<ScopeKey>('mine')
  const [localSourceFilter, setSourceFilter] = useState<TaskSource | 'all'>('all')
  const [localPriorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all')
  const [localAssigneeFilter, setAssigneeFilter] = useState<string | 'all'>('all')
  const scope = pagination?.params.scope ?? localScope
  const sourceFilter = pagination?.params.source ?? localSourceFilter
  const priorityFilter = pagination?.params.priority ?? localPriorityFilter
  const assigneeFilter = pagination?.params.assignee ?? localAssigneeFilter
  const [localOpenOnly, setOpenOnly] = useState(true)
  const openOnly = pagination ? !pagination.params.showDone : localOpenOnly
  // Embedded/test consumers that do not provide canonical summaries retain
  // the legacy due-date queue. The real page always provides them and opens in
  // the shared priority order.
  const [localGroupBy, setLocalGroupBy] = useState<GroupKey>(() =>
    workSummaries === EMPTY_WORK_SUMMARIES ? 'due' : 'priority',
  )
  // On the paged page the grouping lives in the URL, because the server pages
  // differently for it: grouped by matter, a page holds whole matters, so one
  // matter's tasks are never split across two pages.
  const groupBy = pagination?.params.group ?? localGroupBy
  const setGroupBy = (group: GroupKey) => {
    if (pagination) navigate({ group })
    else setLocalGroupBy(group)
  }
  const pageCount = pagination
    ? pagination.pageCount ?? Math.max(1, Math.ceil(pagination.total / pagination.params.pageSize))
    : 1
  const [laterOpen, setLaterOpen] = useState(false)
  const [waitingOpen, setWaitingOpen] = useState(false)
  const [doneOpen, setDoneOpen] = useState(false)
  // ⌘K links a task as `/admin/tasks?focus=<id>`, so the row it found is the
  // one highlighted on arrival. It is a seed, not a binding: the keyboard
  // moves focus from here as usual, and a task outside the current scope or
  // filter simply has no row to highlight — the same as landing on the list.
  const [focusId, setFocusId] = useState<string | null>(() => searchParams?.get('focus') ?? null)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [assignMenuOpen, setAssignMenuOpen] = useState(false)
  const [bulkSnoozeOpen, setBulkSnoozeOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [bulkBusy, setBulkBusy] = useState<BulkAction | null>(null)
  const [snoozeMenuId, setSnoozeMenuId] = useState<string | null>(null)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [templateList, setTemplateList] = useState(templates)
  const [composerOpen, setComposerOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<TaskRow | null>(null)
  const composerRef = useRef<TaskComposerHandle>(null)

  useEffect(() => {
    setOpenTasks(initialOpenTasks)
    setDoneToday(initialDoneToday)
  }, [initialOpenTasks, initialDoneToday])

  const { presentation, selectPresentation } = useTaskPresentation()
  const actions = useTaskActions()

  /** Move a completed task into the Done group without waiting on the server. */
  const applyUpdate = useCallback((updated: TaskRow) => {
    if (updated.status === 'done') {
      setOpenTasks(prev => prev.filter(t => t.id !== updated.id))
      setDoneToday(prev => (prev.some(t => t.id === updated.id) ? prev : [updated, ...prev]))
    } else {
      setDoneToday(prev => prev.filter(t => t.id !== updated.id))
      setOpenTasks(prev =>
        prev.some(t => t.id === updated.id)
          ? prev.map(t => (t.id === updated.id ? updated : t))
          : [...prev, updated].sort(compareTasks),
      )
    }
  }, [])

  const toggleTask = useCallback(
    async (task: TaskRow) => {
      // Optimistic: the row jumps groups now, the PATCH confirms it.
      applyUpdate({ ...task, status: task.status === 'done' ? 'open' : 'done' })
      const updated = task.status === 'done' ? await actions.reopen(task) : await actions.complete(task)
      if (updated) applyUpdate(updated)
      else applyUpdate(task)
      router.refresh()
    },
    [actions, applyUpdate, router],
  )

  const snoozeTask = useCallback(
    async (task: TaskRow, days: number, label: string) => {
      const updated = await actions.snooze(task, days, label)
      if (updated) applyUpdate(updated)
      router.refresh()
    },
    [actions, applyUpdate, router],
  )

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const assignSelection = useCallback(
    async (assigneeId: string | null, assigneeName: string) => {
      const ids = [...selectedIds]
      if (ids.length === 0) return
      setAssignMenuOpen(false)
      setBulkBusy('assign')
      try {
        const updated = await actions.assignMany(ids, assigneeId, assigneeName)
        // Only on success: a failed call leaves the selection intact so the
        // same keystroke retries it, rather than making the user rebuild it.
        if (updated) {
          updated.forEach(applyUpdate)
          router.refresh()
          clearSelection()
        }
      } finally {
        setBulkBusy(null)
      }
    },
    [actions, applyUpdate, clearSelection, selectedIds, router],
  )

  const snoozeSelection = useCallback(
    async (days: number, label: string) => {
      const ids = [...selectedIds]
      if (ids.length === 0) return
      setBulkSnoozeOpen(false)
      setBulkBusy('snooze')
      try {
        const updated = await actions.snoozeMany(ids, days, label)
        if (updated) {
          updated.forEach(applyUpdate)
          router.refresh()
          clearSelection()
        }
      } finally {
        setBulkBusy(null)
      }
    },
    [actions, applyUpdate, clearSelection, selectedIds, router],
  )

  const deleteSelection = useCallback(async () => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    setConfirmDeleteOpen(false)
    setBulkBusy('delete')
    try {
      const deleted = await actions.removeMany(ids)
      if (deleted) {
        const gone = new Set(deleted)
        setOpenTasks(prev => prev.filter(task => !gone.has(task.id)))
        setDoneToday(prev => prev.filter(task => !gone.has(task.id)))
        router.refresh()
        clearSelection()
      }
    } finally {
      setBulkBusy(null)
    }
  }, [actions, clearSelection, selectedIds, router])

  const toggleSubtask = useCallback(
    async (task: TaskRow, index: number, done: boolean) => {
      const updated = await actions.toggleChecklistItem(task, index, done)
      if (updated) applyUpdate(updated)
      router.refresh()
    },
    [actions, applyUpdate, router],
  )

  // The due-date groups are always the open queue; `openOnly` governs whether
  // what was cleared today shows underneath them.
  const scoped = useMemo(() => {
    return openTasks.filter(task => {
      if (scope === 'mine' && task.assignee_id !== viewerId) return false
      if (scope === 'team' && (!task.assignee_id || task.assignee_id === viewerId)) return false
      if (scope === 'unassigned' && task.assignee_id) return false
      if (sourceFilter !== 'all' && task.source !== sourceFilter) return false
      if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false
      if (assigneeFilter !== 'all' && task.assignee_id !== assigneeFilter) return false
      return true
    })
  }, [openTasks, scope, viewerId, sourceFilter, priorityFilter, assigneeFilter])

  const localScopeCounts = useMemo(() => ({
    mine: openTasks.filter(t => t.assignee_id === viewerId).length,
    team: openTasks.filter(t => t.assignee_id && t.assignee_id !== viewerId).length,
    unassigned: openTasks.filter(t => !t.assignee_id).length,
  }), [openTasks, viewerId])

  const scopeCounts = pagination?.scopeCounts ?? localScopeCounts

  const groups = useMemo(() => {
    const buckets: Record<TaskDueGroup, TaskRow[]> = {
      overdue: [], today: [], week: [], later: [], none: [], done: [],
    }
    for (const task of scoped) buckets[taskDueGroup(task)].push(task)
    // Undated work is not urgent but must not vanish — it rides with Later.
    buckets.later = [...buckets.later, ...buckets.none].sort(compareTasks)
    return buckets
  }, [scoped])

  const priorityGroups = useMemo(() => {
    const buckets: Record<PriorityGroupKey, TaskRow[]> = {
      critical: [], today: [], soon: [], planned: [], waiting: [],
    }
    for (const task of scoped) {
      const band = workSummaries[task.id]?.priorityBand ?? 3
      const key: PriorityGroupKey = band === 0
        ? 'critical'
        : band === 1
          ? 'today'
          : band === 2
            ? 'soon'
            : band === 4
              ? 'waiting'
              : 'planned'
      buckets[key].push(task)
    }
    const compare = compareTasksByWorkSummary(workSummaries, compareTasks)
    for (const rows of Object.values(buckets)) rows.sort(compare)
    return buckets
  }, [scoped, workSummaries])

  const recordGroups = useMemo(
    // Paged, the server has already ordered matters most-urgent-first across
    // pages; re-sorting each page A–Z would restart the alphabet on every page.
    () => (groupBy === 'matter' ? groupTasksByRecord(scoped, { keepOrder: Boolean(pagination) }) : []),
    [groupBy, scoped, pagination],
  )

  const doneTodayScoped = useMemo(
    () => (openOnly ? [] : doneToday).filter(task => {
      if (scope === 'mine' && task.assignee_id !== viewerId) return false
      if (scope === 'team' && (!task.assignee_id || task.assignee_id === viewerId)) return false
      if (scope === 'unassigned' && task.assignee_id) return false
      if (sourceFilter !== 'all' && task.source !== sourceFilter) return false
      return true
    }),
    [doneToday, openOnly, scope, viewerId, sourceFilter],
  )

  // What J/K walk through, in the order the groups render.
  const focusOrder = useMemo(
    () => [
      ...(groupBy === 'matter'
        ? recordGroups.flatMap(group => group.tasks)
        : groupBy === 'priority'
          ? [
              ...priorityGroups.critical,
              ...priorityGroups.today,
              ...priorityGroups.soon,
              ...(laterOpen ? priorityGroups.planned : []),
              ...(waitingOpen ? priorityGroups.waiting : []),
            ]
          : [...groups.overdue, ...groups.today, ...groups.week, ...(laterOpen ? groups.later : [])]),
      ...(doneOpen ? doneTodayScoped : []),
    ],
    [groupBy, recordGroups, groups, priorityGroups, laterOpen, waitingOpen, doneOpen, doneTodayScoped],
  )

  // A filter can hide a row that is still selected, and "6 selected" over a
  // list showing three is the kind of lie that makes people stop trusting the
  // count. The selection is pruned to what is on screen rather than silently
  // carrying rows nobody can see.
  useEffect(() => {
    setSelectedIds(prev => {
      if (prev.size === 0) return prev
      const visible = new Set(focusOrder.map(task => task.id))
      const next = new Set([...prev].filter(id => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [focusOrder])

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if (presentation !== 'list') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      // Never steal keys from inputs, dialogs or the rail.
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], aside')) return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return

      const index = focusOrder.findIndex(t => t.id === focusId)
      const focused = index >= 0 ? focusOrder[index] : null
      const move = (delta: number) => {
        if (focusOrder.length === 0) return
        const next = index === -1 ? (delta > 0 ? 0 : focusOrder.length - 1) : index + delta
        const clamped = Math.max(0, Math.min(focusOrder.length - 1, next))
        setFocusId(focusOrder[clamped].id)
        document.getElementById(`task-row-${focusOrder[clamped].id}`)?.scrollIntoView({ block: 'nearest' })
      }

      switch (event.key) {
        case 'j': case 'J': case 'ArrowDown':
          event.preventDefault(); move(1); break
        case 'k': case 'K': case 'ArrowUp':
          event.preventDefault(); move(-1); break
        case 'x': case 'X':
          if (focused) { event.preventDefault(); void toggleTask(focused) }
          break
        case 'e': case 'E': case 'Enter':
          if (focused) {
            event.preventDefault()
            const href = focused.matter_id
              ? `/admin/matters/${focused.matter_id}?tab=tasks`
              : focused.lead_id
                ? `/admin/crm/opportunities/${focused.lead_id}?tab=tasks`
                : null
            if (href) router.push(href)
          }
          break
        case 's': case 'S':
          // Like `a`: a held selection is what the key acts on, otherwise the
          // focused row.
          if (selectedIds.size > 0) { event.preventDefault(); setBulkSnoozeOpen(true) }
          else if (focused) { event.preventDefault(); setSnoozeMenuId(focused.id) }
          break
        case ' ':
          // Selection is deliberately separate from `x`: `x` finishes a task,
          // space only marks it, and confusing the two costs real work.
          if (focused) { event.preventDefault(); toggleSelected(focused.id) }
          break
        case 'a': case 'A':
          event.preventDefault()
          // Falls back to the focused row so the key means the same thing
          // whether or not a selection has been built up yet.
          if (selectedIds.size > 0) setAssignMenuOpen(true)
          else if (focused) { toggleSelected(focused.id); setAssignMenuOpen(true) }
          break
        case '1': event.preventDefault(); setScope('mine'); setFocusId(null); clearSelection(); break
        case '2': event.preventDefault(); setScope('team'); setFocusId(null); clearSelection(); break
        case '3': event.preventDefault(); setScope('unassigned'); setFocusId(null); clearSelection(); break
        case 'Escape':
          // Two stages, widest first: a selection is the more surprising state
          // to be left holding, so it goes before the cursor does.
          if (selectedIds.size > 0) clearSelection()
          else setFocusId(null)
          break
        default: break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [clearSelection, focusId, focusOrder, presentation, router, selectedIds, toggleSelected, toggleTask])

  // ⌘⇧T opens quick capture from anywhere on this page.
  useEffect(() => {
    function openCapture() {
      setComposerOpen(true)
      requestAnimationFrame(() => composerRef.current?.focus())
    }
    function handleKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault()
        openCapture()
      }
    }
    window.addEventListener('keydown', handleKey)
    window.addEventListener(OPEN_TASK_CAPTURE_EVENT, openCapture)
    return () => {
      window.removeEventListener('keydown', handleKey)
      window.removeEventListener(OPEN_TASK_CAPTURE_EVENT, openCapture)
    }
  }, [])

  const renderRow = (task: TaskRow) => (
    <TaskListRow
      key={task.id}
      task={task}
      workSummary={workSummaries[task.id]}
      focused={focusId === task.id}
      selected={selectedIds.has(task.id)}
      onToggleSelected={() => toggleSelected(task.id)}
      pending={actions.isPending(task.id)}
      onComplete={() => void toggleTask(task)}
      onToggleSubtask={(index, done) => void toggleSubtask(task, index, done)}
      onOpen={task.source === 'stage' ? undefined : () => setSelectedTask(task)}
      actions={
        task.status === 'done' ? undefined : (
          <DropdownMenu
            open={snoozeMenuId === task.id}
            onOpenChange={open => setSnoozeMenuId(open ? task.id : null)}
          >
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 text-xs">
                <PauseCircle className="size-3.5" />
                <span className="sr-only sm:not-sr-only">Snooze</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs font-medium">Push due date</DropdownMenuLabel>
              {SNOOZE_OPTIONS.map(option => (
                <DropdownMenuItem
                  key={option.label}
                  onSelect={() => void snoozeTask(task, option.days, option.label)}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
    />
  )

  const nothingToShow = scoped.length === 0

  return (
    // Full width, matching Matters and Drafting — the queue reads better with
    // the room the admin shell already gives every other list page.
    <div className="w-full space-y-4">
      <PageHeader
        eyebrow="Firm work"
        icon={ListTodo}
        title="Tasks"
        description="Assignments, deadlines, and follow-up across leads and matters."
        actions={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setTemplatesOpen(true)}>
              <Layers className="size-4" />
              Templates
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setComposerOpen(true)
                requestAnimationFrame(() => composerRef.current?.focus())
              }}
            >
              <Plus className="size-4" />
              New task
              <kbd className="ml-1 hidden rounded border border-primary-foreground/30 px-1 text-micro sm:inline">
                ⌘⇧T
              </kbd>
            </Button>
          </>
        }
      />

      {composerOpen && (
        <TaskComposer
          ref={composerRef}
          className="border-border"
          onCreate={async input => {
            const created = await actions.create(input)
            if (created) {
              setOpenTasks(prev => [...prev, created].sort(compareTasks))
              router.refresh()
            }
            return created
          }}
        />
      )}

      <section aria-label="Task controls" className="space-y-3 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={scope} onValueChange={value => { if (pagination) navigate({ scope: value }); else setScope(value as ScopeKey); setFocusId(null); clearSelection() }}>
            <TabsList>
              <TabsTrigger value="mine">Mine ({scopeCounts.mine})</TabsTrigger>
              <TabsTrigger value="team">Team ({scopeCounts.team})</TabsTrigger>
              <TabsTrigger value="unassigned">Unassigned ({scopeCounts.unassigned})</TabsTrigger>
            </TabsList>
          </Tabs>
      <TaskPresentationSwitch value={presentation} onChange={value => { clearSelection(); selectPresentation(value) }} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-2">


          <FilterMenu
            label="Source"
            value={sourceFilter === 'all' ? 'All sources' : TASK_SOURCE_LABEL[sourceFilter]}
            options={[
              { value: 'all', label: 'All sources' },
              ...TASK_SOURCES.map(source => ({ value: source, label: TASK_SOURCE_LABEL[source] })),
            ]}
            onSelect={value => pagination ? navigate({ source: value }) : setSourceFilter(value as TaskSource | 'all')}
          />
          <FilterMenu
            label="Priority"
            value={priorityFilter === 'all' ? 'Any priority' : priorityFilter}
            options={[
              { value: 'all', label: 'Any priority' },
              { value: 'high', label: 'High' },
              { value: 'normal', label: 'Normal' },
              { value: 'low', label: 'Low' },
            ]}
            onSelect={value => pagination ? navigate({ priority: value }) : setPriorityFilter(value as TaskPriority | 'all')}
          />
          <FilterMenu
            label="Assignee"
            value={assigneeFilter === 'all'
              ? 'Anyone'
              : assignees.find(a => a.id === assigneeFilter)?.name ?? 'Anyone'}
            options={[
              { value: 'all', label: 'Anyone' },
              ...assignees.map(a => ({ value: a.id, label: a.name })),
            ]}
            onSelect={value => pagination ? navigate({ assignee: value }) : setAssigneeFilter(value)}
          />

          {openOnly && (
            <button
              type="button"
              // Clearing the filter reveals what was cleared today, so the
              // collapsed Done group opens with it.
              onClick={() => {
                if (pagination) navigate({ done: '1' })
                setOpenOnly(false)
                setDoneOpen(true)
              }}
              className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-micro font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Open only
              <X className="size-3" aria-hidden />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs">
                {presentation === 'list' ? 'Group' : 'Page order'}: {groupBy === 'matter' ? 'Matter' : groupBy === 'priority' ? 'Priority' : 'Due date'}
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs">{presentation === 'list' ? 'Group by' : 'Order pages by'}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => { setGroupBy('priority'); setFocusId(null) }}>
                Priority
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setGroupBy('due'); setFocusId(null) }}>
                Due date
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setGroupBy('matter'); setFocusId(null) }}>
                Matter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {presentation === 'list' && <span className="hidden items-center gap-1.5 text-micro text-muted-foreground lg:inline-flex">
            <kbd className="rounded border border-border bg-muted px-1">J</kbd>
            <kbd className="rounded border border-border bg-muted px-1">K</kbd>
            move
            <span aria-hidden>·</span>
            <kbd className="rounded border border-border bg-muted px-1">X</kbd>
            complete
            <span aria-hidden>·</span>
            <kbd className="rounded border border-border bg-muted px-1">Space</kbd>
            select
            <span aria-hidden>·</span>
            <kbd className="rounded border border-border bg-muted px-1">A</kbd>
            assign
            <span aria-hidden>·</span>
            <kbd className="rounded border border-border bg-muted px-1">S</kbd>
            snooze
          </span>}
        </div>
      </div>
      </section>

      {pagination && (pagination.total > 0 || pagination.params.showDone) && <nav className="flex flex-wrap items-center gap-3 text-sm" aria-label="Task pages">
        <span>{pagination.total} matching open tasks · page {pagination.params.page} of {pageCount}. {groupBy === 'matter' ? 'Each matter’s tasks stay together on one page.' : presentation === 'list' ? 'Groups below show this page.' : 'Showing tasks from this page.'}</span>
        <Button variant="outline" size="sm" disabled={pagination.params.page <= 1} onClick={() => navigate({ page: String(pagination.params.page - 1) })}>Previous</Button>
        <Button variant="outline" size="sm" disabled={pagination.params.page >= pageCount} onClick={() => navigate({ page: String(pagination.params.page + 1) })}>Next</Button>
        {pagination.params.showDone && <div className="flex items-center gap-2">
          <span>{pagination.doneTotal} completed today · page {pagination.params.donePage}</span>
          <Button variant="outline" size="sm" disabled={pagination.params.donePage <= 1} onClick={() => navigate({ donePage: String(pagination.params.donePage - 1), page: String(pagination.params.page) })}>Previous completed</Button>
          <Button variant="outline" size="sm" disabled={pagination.params.donePage * pagination.params.pageSize >= pagination.doneTotal} onClick={() => navigate({ donePage: String(pagination.params.donePage + 1), page: String(pagination.params.page) })}>Next completed</Button>
        </div>}
      </nav>}
      {presentation !== 'list' ? <TaskPresentationView tasks={[...scoped, ...doneTodayScoped]} presentation={presentation} onOpen={setSelectedTask} isPending={actions.isPending} onStatus={async (task, status) => {
        const updated = status === 'done' ? await actions.complete(task) : await actions.patch(task.id, { status })
        if (updated) { applyUpdate(updated); router.refresh() }
      }} /> : nothingToShow && doneTodayScoped.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="Nothing in this queue"
          description="Stage tasks appear here as matters move; add your own with ⌘⇧T."
          className="rounded-lg border border-border bg-card"
        />
      ) : (
        <div>
          {groupBy === 'matter' ? (
            recordGroups.map(group => (
              <GroupShell key={group.key} title={group.label} count={group.tasks.length}>
                {group.tasks.map(renderRow)}
              </GroupShell>
            ))
          ) : groupBy === 'priority' ? (
            <>
              <GroupShell title="Critical" count={priorityGroups.critical.length} accent>
                {priorityGroups.critical.map(renderRow)}
              </GroupShell>
              <GroupShell title="Must do today" count={priorityGroups.today.length}>
                {priorityGroups.today.map(renderRow)}
              </GroupShell>
              <GroupShell title="Soon · next 3 business days" count={priorityGroups.soon.length}>
                {priorityGroups.soon.map(renderRow)}
              </GroupShell>
              <CollapsedGroup
                title="Planned"
                count={priorityGroups.planned.length}
                open={laterOpen}
                onToggle={() => setLaterOpen(prev => !prev)}
              >
                {priorityGroups.planned.map(renderRow)}
              </CollapsedGroup>
              <CollapsedGroup
                title="Waiting & blocked"
                count={priorityGroups.waiting.length}
                open={waitingOpen}
                onToggle={() => setWaitingOpen(prev => !prev)}
              >
                {priorityGroups.waiting.map(renderRow)}
              </CollapsedGroup>
            </>
          ) : (
            <>
              <GroupShell title="Overdue" count={groups.overdue.length} accent>
                {groups.overdue.map(renderRow)}
              </GroupShell>
              <GroupShell title={`Today · ${TODAY_LABEL.format(new Date())}`} count={groups.today.length}>
                {groups.today.map(renderRow)}
              </GroupShell>
              <GroupShell title="This week" count={groups.week.length}>
                {groups.week.map(renderRow)}
              </GroupShell>
              <CollapsedGroup
                title="Later"
                count={groups.later.length}
                open={laterOpen}
                onToggle={() => setLaterOpen(prev => !prev)}
              >
                {groups.later.map(renderRow)}
              </CollapsedGroup>
            </>
          )}
          <CollapsedGroup
            title="Done today"
            count={doneTodayScoped.length}
            open={doneOpen}
            onToggle={() => setDoneOpen(prev => !prev)}
          >
            {doneTodayScoped.map(renderRow)}
          </CollapsedGroup>
        </div>
      )}

      {selectedIds.size > 0 && (
        <SelectionBar
          count={selectedIds.size}
          assignees={assignees}
          viewerId={viewerId}
          visibleCount={focusOrder.length}
          busy={bulkBusy}
          menuOpen={assignMenuOpen}
          onMenuOpenChange={setAssignMenuOpen}
          onAssign={(id, name) => void assignSelection(id, name)}
          snoozeMenuOpen={bulkSnoozeOpen}
          onSnoozeMenuOpenChange={setBulkSnoozeOpen}
          onSnooze={(days, label) => void snoozeSelection(days, label)}
          onDelete={() => setConfirmDeleteOpen(true)}
          onSelectAll={() => setSelectedIds(new Set(focusOrder.map(task => task.id)))}
          onClear={clearSelection}
        />
      )}

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.size} task{selectedIds.size === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The selected tasks and their subtasks will be removed. Tasks created automatically
              (fiduciary gaps, name checks, plan tasks) are dismissed so they aren’t created again.
              Stage tasks are managed by the stage engine and will be kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void deleteSelection()}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete {selectedIds.size === 1 ? 'task' : 'tasks'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TaskTemplateSheet
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        templates={templateList}
        assignees={assignees}
        onTemplatesChange={setTemplateList}
      />
      <TaskDetailSheet
        task={selectedTask}
        assignees={assignees}
        open={Boolean(selectedTask)}
        onOpenChange={open => {
          if (!open) setSelectedTask(null)
        }}
        onUpdated={updated => {
          applyUpdate(updated)
          setSelectedTask(updated)
          router.refresh()
        }}
        onDeleted={deleted => {
          setOpenTasks(current => current.filter(task => task.id !== deleted.id))
          setDoneToday(current => current.filter(task => task.id !== deleted.id))
          setSelectedTask(null)
          router.refresh()
        }}
      />
    </div>
  )
}

/**
 * The one thing on this page that only exists while a selection does.
 *
 * Selection built by keyboard is otherwise invisible state — you can hold six
 * rows and have nothing on screen say so, and nothing say how to act on them.
 * The bar is the selection's receipt: the count, the action, and the way out.
 */
function SelectionBar({
  count,
  assignees,
  viewerId,
  visibleCount,
  busy,
  menuOpen,
  onMenuOpenChange,
  onAssign,
  snoozeMenuOpen,
  onSnoozeMenuOpenChange,
  onSnooze,
  onDelete,
  onSelectAll,
  onClear,
}: {
  count: number
  assignees: Assignee[]
  viewerId: string | null
  /** Rows on screen right now — what "Select all" would hold. */
  visibleCount: number
  busy: BulkAction | null
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  onAssign: (assigneeId: string | null, assigneeName: string) => void
  snoozeMenuOpen: boolean
  onSnoozeMenuOpenChange: (open: boolean) => void
  onSnooze: (days: number, label: string) => void
  onDelete: () => void
  onSelectAll: () => void
  onClear: () => void
}) {
  const me = assignees.find(person => person.id === viewerId)
  const others = assignees.filter(person => person.id !== viewerId)

  return (
    <div className="sticky bottom-4 z-20 flex justify-center">
      <div
        role="status"
        className="flex flex-wrap items-center justify-center gap-2 rounded-full border border-border bg-card px-4 py-2 shadow-lg"
      >
        <span className="text-sm font-medium">
          {count} selected
        </span>
        {count < visibleCount && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={onSelectAll}
          >
            Select all {visibleCount}
          </Button>
        )}
        <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" className="h-7 text-xs" disabled={busy !== null}>
              {busy === 'assign' ? 'Assigning…' : 'Assign'}
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-52">
            <DropdownMenuLabel className="text-xs">Assign {count} to</DropdownMenuLabel>
            {me && (
              <DropdownMenuItem onSelect={() => onAssign(me.id, me.name)}>
                Me ({me.name})
              </DropdownMenuItem>
            )}
            {others.map(person => (
              <DropdownMenuItem key={person.id} onSelect={() => onAssign(person.id, person.name)}>
                {person.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={() => onAssign(null, 'nobody')}>
              Nobody — leave unassigned
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu open={snoozeMenuOpen} onOpenChange={onSnoozeMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={busy !== null}>
              <PauseCircle className="size-3.5" aria-hidden />
              {busy === 'snooze' ? 'Snoozing…' : 'Snooze'}
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="w-44">
            <DropdownMenuLabel className="text-xs">Push {count} due date{count === 1 ? '' : 's'}</DropdownMenuLabel>
            {SNOOZE_OPTIONS.map(option => (
              <DropdownMenuItem key={option.label} onSelect={() => onSnooze(option.days, option.label)}>
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs text-destructive hover:text-destructive"
          disabled={busy !== null}
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" aria-hidden />
          {busy === 'delete' ? 'Deleting…' : 'Delete'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={onClear}
        >
          <X className="size-3.5" aria-hidden />
          Clear
        </Button>
      </div>
    </div>
  )
}

function FilterMenu({
  label,
  value,
  options,
  onSelect,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onSelect: (value: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs">
          {value}
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuLabel className="text-xs">{label}</DropdownMenuLabel>
        {options.map(option => (
          <DropdownMenuItem key={option.value} onSelect={() => onSelect(option.value)}>
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
