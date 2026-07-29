'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronDown,
  ChevronRight,
  Layers,
  ListTodo,
  PauseCircle,
  Plus,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  TASK_SOURCES,
  TASK_SOURCE_LABEL,
  compareTasks,
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

type ScopeKey = 'mine' | 'team' | 'unassigned'

interface Assignee {
  id: string
  name: string
}

interface TemplateSummary {
  id: string
  name: string
  description: string | null
  items: Array<{ text: string }>
}

interface TasksClientProps {
  initialOpenTasks: TaskRow[]
  initialDoneToday: TaskRow[]
  assignees: Assignee[]
  templates: TemplateSummary[]
  viewerId: string | null
}

const TODAY_LABEL = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: FIRM_TIMEZONE,
})

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
  return (
    <section>
      <div className="flex items-center gap-2 px-1 pb-1 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        <Badge
          variant="secondary"
          className={cn('text-[11px] tabular-nums', accent && 'bg-destructive/15 text-destructive')}
        >
          {count}
        </Badge>
      </div>
      <ul
        className={cn(
          'divide-y divide-border overflow-hidden rounded-lg border border-border bg-card',
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
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
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
}: TasksClientProps) {
  const router = useRouter()
  const [openTasks, setOpenTasks] = useState(initialOpenTasks)
  const [doneToday, setDoneToday] = useState(initialDoneToday)
  const [scope, setScope] = useState<ScopeKey>('mine')
  const [sourceFilter, setSourceFilter] = useState<TaskSource | 'all'>('all')
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | 'all'>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string | 'all'>('all')
  const [openOnly, setOpenOnly] = useState(true)
  const [laterOpen, setLaterOpen] = useState(false)
  const [doneOpen, setDoneOpen] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [snoozeMenuId, setSnoozeMenuId] = useState<string | null>(null)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [composerOpen, setComposerOpen] = useState(false)
  const composerRef = useRef<TaskComposerHandle>(null)

  useEffect(() => {
    setOpenTasks(initialOpenTasks)
    setDoneToday(initialDoneToday)
  }, [initialOpenTasks, initialDoneToday])

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
    },
    [actions, applyUpdate],
  )

  const snoozeTask = useCallback(
    async (task: TaskRow, days: number, label: string) => {
      const updated = await actions.snooze(task, days, label)
      if (updated) applyUpdate(updated)
    },
    [actions, applyUpdate],
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

  const scopeCounts = useMemo(() => ({
    mine: openTasks.filter(t => t.assignee_id === viewerId).length,
    team: openTasks.filter(t => t.assignee_id && t.assignee_id !== viewerId).length,
    unassigned: openTasks.filter(t => !t.assignee_id).length,
  }), [openTasks, viewerId])

  const groups = useMemo(() => {
    const buckets: Record<TaskDueGroup, TaskRow[]> = {
      overdue: [], today: [], week: [], later: [], none: [], done: [],
    }
    for (const task of scoped) buckets[taskDueGroup(task)].push(task)
    // Undated work is not urgent but must not vanish — it rides with Later.
    buckets.later = [...buckets.later, ...buckets.none].sort(compareTasks)
    return buckets
  }, [scoped])

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
      ...groups.overdue,
      ...groups.today,
      ...groups.week,
      ...(laterOpen ? groups.later : []),
      ...(doneOpen ? doneTodayScoped : []),
    ],
    [groups, laterOpen, doneOpen, doneTodayScoped],
  )

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      // Never steal keys from inputs, dialogs or the rail.
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], aside')) return
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
                ? `/admin/leads/${focused.lead_id}?tab=tasks`
                : null
            if (href) router.push(href)
          }
          break
        case 's': case 'S':
          if (focused) { event.preventDefault(); setSnoozeMenuId(focused.id) }
          break
        case '1': event.preventDefault(); setScope('mine'); setFocusId(null); break
        case '2': event.preventDefault(); setScope('team'); setFocusId(null); break
        case '3': event.preventDefault(); setScope('unassigned'); setFocusId(null); break
        case 'Escape': setFocusId(null); break
        default: break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [focusId, focusOrder, router, toggleTask])

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
      focused={focusId === task.id}
      pending={actions.isPending(task.id)}
      onComplete={() => void toggleTask(task)}
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

  const nothingToShow =
    groups.overdue.length + groups.today.length + groups.week.length + groups.later.length === 0

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <PageHeader
        eyebrow="Firm work"
        icon={ListTodo}
        title="Tasks"
        description="Everything the firm owes someone — stage-engine tasks and tasks you added by hand, in one queue."
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
              <kbd className="ml-1 hidden rounded border border-primary-foreground/30 px-1 text-[10px] sm:inline">
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={scope} onValueChange={value => { setScope(value as ScopeKey); setFocusId(null) }}>
            <TabsList>
              <TabsTrigger value="mine">Mine ({scopeCounts.mine})</TabsTrigger>
              <TabsTrigger value="team">Team ({scopeCounts.team})</TabsTrigger>
              <TabsTrigger value="unassigned">Unassigned ({scopeCounts.unassigned})</TabsTrigger>
            </TabsList>
          </Tabs>

          <FilterMenu
            label="Source"
            value={sourceFilter === 'all' ? 'All sources' : TASK_SOURCE_LABEL[sourceFilter]}
            options={[
              { value: 'all', label: 'All sources' },
              ...TASK_SOURCES.map(source => ({ value: source, label: TASK_SOURCE_LABEL[source] })),
            ]}
            onSelect={value => setSourceFilter(value as TaskSource | 'all')}
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
            onSelect={value => setPriorityFilter(value as TaskPriority | 'all')}
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
            onSelect={setAssigneeFilter}
          />

          {openOnly && (
            <button
              type="button"
              // Clearing the filter reveals what was cleared today, so the
              // collapsed Done group opens with it.
              onClick={() => {
                setOpenOnly(false)
                setDoneOpen(true)
              }}
              className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground"
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
                Group: Due date
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs">Group by</DropdownMenuLabel>
              <DropdownMenuItem disabled>Due date</DropdownMenuItem>
              <DropdownMenuSeparator />
              <p className="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
                Other groupings arrive with saved views.
              </p>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground lg:inline-flex">
            <kbd className="rounded border border-border bg-muted px-1">J</kbd>
            <kbd className="rounded border border-border bg-muted px-1">K</kbd>
            move
            <span aria-hidden>·</span>
            <kbd className="rounded border border-border bg-muted px-1">X</kbd>
            complete
          </span>
        </div>
      </div>

      {nothingToShow && doneTodayScoped.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="Nothing in this queue"
          description="Stage tasks appear here as matters move; add your own with ⌘⇧T."
          className="rounded-lg border border-border bg-card"
        />
      ) : (
        <div>
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

      <Sheet open={templatesOpen} onOpenChange={setTemplatesOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Task templates</SheetTitle>
            <SheetDescription>
              Apply a template from a matter or lead’s Tasks tab, or type <strong>/</strong> in quick capture.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3 overflow-auto px-4 pb-4">
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No templates yet.</p>
            ) : (
              templates.map(template => (
                <div key={template.id} className="rounded-lg border border-border bg-card p-3">
                  <p className="text-sm font-medium text-foreground">{template.name}</p>
                  {template.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{template.description}</p>
                  )}
                  <ul className="mt-2 space-y-1">
                    {template.items.map((item, index) => (
                      <li key={index} className="text-xs text-muted-foreground">
                        · {item.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
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
