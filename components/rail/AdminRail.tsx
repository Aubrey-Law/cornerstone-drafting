'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ListTodo,
  Mail,
  Minus,
  PanelRight,
  Sparkles,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  CORNERSTONE_CHAT_OPEN_EVENT,
  type CornerstoneChatOpenDetail,
} from '@/app/admin/components/adminChatEvents'
import { RailActivityPane } from './RailActivityPane'
import { RailEmailPane } from './RailEmailPane'
import { RailTasksPane } from './RailTasksPane'

const ChatPanel = dynamic(
  () => import('@/app/admin/components/ChatPanel').then(m => m.ChatPanel),
  { ssr: false },
)

export type RailTab = 'assistant' | 'email' | 'tasks' | 'activity'

const RAIL_STORAGE_KEY = 'cornerstone.admin.rail'

interface StoredRailState {
  open?: boolean
  minimized?: boolean
  tab?: RailTab
}

const RAIL_TABS: readonly RailTab[] = ['assistant', 'email', 'tasks', 'activity']

function isRailTab(value: unknown): value is RailTab {
  return typeof value === 'string' && (RAIL_TABS as readonly string[]).includes(value)
}

export interface AdminRailController {
  open: boolean
  minimized: boolean
  tab: RailTab
  /** The rail occupies layout width only when it is open and not minimized. */
  visible: boolean
  pendingChatAction: CornerstoneChatOpenDetail | null
  clearPendingChatAction: () => void
  /** True once the assistant has been opened at least once this page life. */
  assistantMounted: boolean
  /** Same for the email pane, so an unsent draft survives a tab switch. */
  emailMounted: boolean
  /** And the tasks pane, so a half-typed capture survives a tab switch. */
  tasksMounted: boolean
  /** Bumped by ⌘⇧T so the tasks pane knows to focus its capture input. */
  taskCaptureRequestId: number
  openTab: (tab: RailTab) => void
  setTab: (tab: RailTab) => void
  toggle: () => void
  minimize: () => void
  close: () => void
}

/**
 * Owns rail open/minimize/tab state. Lives in the admin shell (not in
 * `AdminRail`) because the topbar toggle and the rail render in different
 * branches of the layout tree.
 */
export function useAdminRail(): AdminRailController {
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [tab, setTabState] = useState<RailTab>('assistant')
  const [assistantMounted, setAssistantMounted] = useState(false)
  const [emailMounted, setEmailMounted] = useState(false)
  const [tasksMounted, setTasksMounted] = useState(false)
  const [taskCaptureRequestId, setTaskCaptureRequestId] = useState(0)
  const [pendingChatAction, setPendingChatAction] = useState<CornerstoneChatOpenDetail | null>(null)
  // State, not a ref: the persist effect must not fire until the restored
  // values have landed, or it would write the defaults back over them.
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RAIL_STORAGE_KEY)
      if (raw) {
        const stored = JSON.parse(raw) as StoredRailState
        if (typeof stored.open === 'boolean') setOpen(stored.open)
        if (typeof stored.minimized === 'boolean') setMinimized(stored.minimized)
        if (isRailTab(stored.tab)) setTabState(stored.tab)
      }
    } catch {
      /* rail state is a convenience; a missing/blocked store is fine */
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(RAIL_STORAGE_KEY, JSON.stringify({ open, minimized, tab }))
    } catch {
      /* ignore */
    }
  }, [hydrated, open, minimized, tab])

  // The assistant, email and tasks panes mount lazily on first view, then stay
  // mounted for the rest of the page life so the chat thread, an unsent email
  // draft and a half-typed task capture survive tab switches and minimize/close.
  useEffect(() => {
    if (!open || minimized) return
    if (tab === 'assistant') setAssistantMounted(true)
    if (tab === 'email') setEmailMounted(true)
    if (tab === 'tasks') setTasksMounted(true)
  }, [open, minimized, tab])

  const openTab = useCallback((next: RailTab) => {
    setTabState(next)
    setOpen(true)
    setMinimized(false)
  }, [])

  const setTab = useCallback((next: RailTab) => {
    setTabState(next)
  }, [])

  const toggle = useCallback(() => {
    if (open && !minimized) {
      setOpen(false)
      return
    }
    setOpen(true)
    setMinimized(false)
  }, [open, minimized])

  const minimize = useCallback(() => setMinimized(true), [])
  const close = useCallback(() => {
    setOpen(false)
    setMinimized(false)
  }, [])

  useEffect(() => {
    function handleOpenChat(event: Event) {
      const detail = (event as CustomEvent<CornerstoneChatOpenDetail>).detail
      setPendingChatAction(detail ?? {})
      openTab('assistant')
    }
    function handleOpenEmail() {
      openTab('email')
    }

    window.addEventListener(CORNERSTONE_CHAT_OPEN_EVENT, handleOpenChat)
    window.addEventListener('cornerstone:email-open', handleOpenEmail)
    return () => {
      window.removeEventListener(CORNERSTONE_CHAT_OPEN_EVENT, handleOpenChat)
      window.removeEventListener('cornerstone:email-open', handleOpenEmail)
    }
  }, [openTab])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!event.metaKey && !event.ctrlKey) return
      const key = event.key.toLowerCase()
      if (!event.shiftKey && key === 'j') {
        event.preventDefault()
        toggle()
        return
      }
      if (!event.shiftKey) return
      if (key === 'a') {
        event.preventDefault()
        openTab('assistant')
        return
      }
      if (key === 'e') {
        event.preventDefault()
        openTab('email')
        return
      }
      if (key === 'k') {
        event.preventDefault()
        openTab('tasks')
        return
      }
      if (key === 't') {
        // The Tasks page owns ⌘⇧T for its own composer; everywhere else quick
        // capture belongs to the rail.
        if (window.location.pathname.startsWith('/admin/tasks')) return
        event.preventDefault()
        openTab('tasks')
        setTaskCaptureRequestId(id => id + 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggle, openTab])

  const clearPendingChatAction = useCallback(() => setPendingChatAction(null), [])

  return useMemo(() => ({
    open,
    minimized,
    tab,
    visible: open && !minimized,
    pendingChatAction,
    clearPendingChatAction,
    assistantMounted,
    emailMounted,
    tasksMounted,
    taskCaptureRequestId,
    openTab,
    setTab,
    toggle,
    minimize,
    close,
  }), [
    open, minimized, tab, pendingChatAction, clearPendingChatAction, assistantMounted, emailMounted,
    tasksMounted, taskCaptureRequestId, openTab, setTab, toggle, minimize, close,
  ])
}

interface AdminRailProps {
  rail: AdminRailController
  matterDisplayName?: string | null
  assistantModelLabel?: string | null
  /** Overdue task count for the Tasks tab badge, from the sidebar counts. */
  tasksOverdue?: number
}

export function AdminRail({
  rail,
  matterDisplayName = null,
  assistantModelLabel = null,
  tasksOverdue = 0,
}: AdminRailProps) {
  const { visible, tab } = rail
  const tabs: { key: RailTab; label: string; icon: typeof Sparkles; dot?: boolean; count?: number }[] = [
    { key: 'assistant', label: 'Assistant', icon: Sparkles },
    { key: 'email', label: 'Email', icon: Mail },
    { key: 'tasks', label: 'Tasks', icon: ListTodo, count: tasksOverdue },
    { key: 'activity', label: 'Activity', icon: Activity },
  ]

  return (
    <aside
      aria-label="Admin rail"
      className={cn(
        'flex shrink-0 flex-col bg-card text-card-foreground transition-[width] duration-200 ease-out',
        visible ? 'w-[min(460px,100vw)] border-l border-border' : 'w-0 overflow-hidden',
      )}
    >
      {visible && (
        <div className="flex h-11 shrink-0 items-center border-b border-border pl-1 pr-1.5">
          {/*
            Four tabs do not fit 460px with labels, so only the active tab keeps
            its text; the rest are 34px icon buttons with a title tooltip.
          */}
          {tabs.map(item => {
            const Icon = item.icon
            const active = tab === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => rail.setTab(item.key)}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                title={item.label}
                className={cn(
                  'relative inline-flex h-11 items-center border-b-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'gap-1.5 border-primary px-2.5 font-semibold text-foreground'
                    : 'w-[34px] justify-center border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {active && item.label}
                {item.count ? (
                  <span
                    className={cn(
                      'rounded-full bg-destructive/15 font-medium tabular-nums text-destructive',
                      active
                        ? 'px-1.5 py-0.5 text-micro'
                        : 'absolute right-0.5 top-1.5 min-w-3.5 px-1 text-micro leading-[14px]',
                    )}
                  >
                    {item.count}
                  </span>
                ) : null}
              </button>
            )
          })}
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              onClick={rail.minimize}
              aria-label="Minimize rail"
              title="Minimize rail"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={rail.close}
              aria-label="Close rail"
              title="Close rail"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/*
        Panes stay mounted across tab switches and rail close so the assistant
        thread and unsent drafts survive.
      */}
      {rail.assistantMounted && (
        <div className={cn('min-h-0 flex-1', visible && tab === 'assistant' ? 'flex flex-col' : 'hidden')}>
          <ChatPanel
            open={visible && tab === 'assistant'}
            pendingAction={rail.pendingChatAction}
            onPendingActionHandled={rail.clearPendingChatAction}
            matterDisplayName={matterDisplayName}
            assistantModelLabel={assistantModelLabel}
          />
        </div>
      )}

      {/*
        Email keeps its draft while the operator looks something up, so it is
        hidden rather than unmounted once it has been opened.
      */}
      {rail.emailMounted && (
        <div className={cn('min-h-0 flex-1', visible && tab === 'email' ? 'flex flex-col' : 'hidden')}>
          <RailEmailPane />
        </div>
      )}

      {/* Kept mounted like the email pane so a half-typed capture survives. */}
      {rail.tasksMounted && (
        <div className={cn('min-h-0 flex-1', visible && tab === 'tasks' ? 'flex flex-col' : 'hidden')}>
          <RailTasksPane captureRequestId={rail.taskCaptureRequestId} />
        </div>
      )}

      {visible && tab === 'activity' && (
        <div className="min-h-0 flex-1">
          <RailActivityPane />
        </div>
      )}

    </aside>
  )
}

export function RailToggleButton({ rail }: { rail: AdminRailController }) {

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={rail.toggle}
      aria-label={rail.visible ? 'Close assistant rail' : 'Open assistant rail'}
      aria-pressed={rail.visible}
      title={`${rail.visible ? 'Close' : 'Open'} assistant rail (⌘J)`}
      className="relative"
    >
      <PanelRight className="h-4 w-4" />
    </Button>
  )
}
