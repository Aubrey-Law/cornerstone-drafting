'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ChevronUp,
  ListTodo,
  Mail,
  Mic,
  MicOff,
  Minus,
  PanelRight,
  Phone,
  PhoneOff,
  Sparkles,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  CORNERSTONE_CHAT_OPEN_EVENT,
  type CornerstoneChatOpenDetail,
} from '@/app/admin/components/adminChatEvents'
import { OPEN_STAFF_SOFTPHONE_EVENT } from '@/app/admin/components/softphoneEvents'
import { useSoftphoneCall } from '@/components/softphone/SoftphoneProvider'
import { RailActivityPane } from './RailActivityPane'
import { RailEmailPane } from './RailEmailPane'
import { RailTasksPane } from './RailTasksPane'

const ChatPanel = dynamic(
  () => import('@/app/admin/components/ChatPanel').then(m => m.ChatPanel),
  { ssr: false },
)

const Softphone = dynamic(() => import('@/components/softphone/Softphone'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading phone…
    </div>
  ),
})

function formatCallDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const seconds = (totalSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

export type RailTab = 'assistant' | 'phone' | 'email' | 'tasks' | 'activity'

const RAIL_STORAGE_KEY = 'cornerstone.admin.rail'

interface StoredRailState {
  open?: boolean
  minimized?: boolean
  tab?: RailTab
}

const RAIL_TABS: readonly RailTab[] = ['assistant', 'phone', 'email', 'tasks', 'activity']

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
export function useAdminRail({ voiceEnabled }: { voiceEnabled: boolean }): AdminRailController {
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

  // The phone tab only exists when voice is configured; never strand the rail on it.
  useEffect(() => {
    if (!voiceEnabled && tab === 'phone') setTabState('assistant')
  }, [voiceEnabled, tab])

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
    function handleOpenPhone() {
      openTab('phone')
    }
    function handleOpenEmail() {
      openTab('email')
    }

    window.addEventListener(CORNERSTONE_CHAT_OPEN_EVENT, handleOpenChat)
    window.addEventListener(OPEN_STAFF_SOFTPHONE_EVENT, handleOpenPhone)
    window.addEventListener('cornerstone:email-open', handleOpenEmail)
    return () => {
      window.removeEventListener(CORNERSTONE_CHAT_OPEN_EVENT, handleOpenChat)
      window.removeEventListener(OPEN_STAFF_SOFTPHONE_EVENT, handleOpenPhone)
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
      if (key === 'p' && voiceEnabled) {
        event.preventDefault()
        openTab('phone')
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
  }, [toggle, openTab, voiceEnabled])

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
  voiceEnabled: boolean
  matterDisplayName?: string | null
  assistantModelLabel?: string | null
  /** Overdue task count for the Tasks tab badge, from the sidebar counts. */
  tasksOverdue?: number
}

export function AdminRail({
  rail,
  voiceEnabled,
  matterDisplayName = null,
  assistantModelLabel = null,
  tasksOverdue = 0,
}: AdminRailProps) {
  const { visible, tab } = rail
  const { call } = useSoftphoneCall()
  const phoneDocked = voiceEnabled && visible && tab === 'phone'
  // A live call keeps its bar on screen whenever the dialer isn't docked.
  const showCallBar = voiceEnabled && !phoneDocked && call.active

  // Incoming and finished calls require an operator decision. Bring the phone
  // forward even when the rail was closed, minimized, or on another tab.
  const { openTab } = rail
  const incoming = call.incoming
  const wrapUpPending = call.wrapUpPending
  useEffect(() => {
    if ((incoming || wrapUpPending) && voiceEnabled) openTab('phone')
  }, [incoming, wrapUpPending, voiceEnabled, openTab])

  const tabs: { key: RailTab; label: string; icon: typeof Sparkles; dot?: boolean; count?: number }[] = [
    { key: 'assistant', label: 'Assistant', icon: Sparkles },
    ...(voiceEnabled
      ? [{ key: 'phone' as const, label: 'Phone', icon: Phone, dot: call.active || call.incoming }]
      : []),
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
            Five tabs do not fit 460px with labels, so only the active tab keeps
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
                    ? 'gap-1.5 border-accent px-2.5 font-semibold text-foreground'
                    : 'w-[34px] justify-center border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {active && item.label}
                {item.dot && (
                  <span
                    aria-label={call.incoming ? 'Incoming call' : 'Call in progress'}
                    role="status"
                    className={cn(
                      'rounded-full bg-success motion-safe:animate-pulse',
                      active ? 'h-1.5 w-1.5' : 'absolute right-1 top-2 h-1.5 w-1.5',
                    )}
                  />
                )}
                {!item.dot && item.count ? (
                  <span
                    className={cn(
                      'rounded-full bg-destructive/15 font-medium tabular-nums text-destructive',
                      active
                        ? 'px-1.5 py-0.5 text-[10px]'
                        : 'absolute right-0.5 top-1.5 min-w-3.5 px-1 text-[9px] leading-[14px]',
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
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={rail.close}
              aria-label="Close rail"
              title="Close rail"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/*
        Panes stay mounted across tab switches and rail close so the assistant
        thread and — critically — an in-progress call survive. The phone pane
        escapes the collapsed rail as a fixed pill rather than unmounting.
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

      {/*
        The dialer never unmounts: the Twilio/Telnyx device and the live call
        live inside it, so the pane is hidden with CSS, not removed. The pane
        owns its own scrolling, so there is no overflow on this wrapper.
      */}
      {voiceEnabled && (
        <div className={cn(phoneDocked ? 'min-h-0 flex-1' : 'hidden')}>
          <Softphone />
        </div>
      )}

      {showCallBar && <MinimizedCallBar onExpand={() => rail.openTab('phone')} />}
    </aside>
  )
}

/** Bottom-right call bar shown while the rail is closed, minimized or on another tab. */
function MinimizedCallBar({ onExpand }: { onExpand: () => void }) {
  const { call, controls } = useSoftphoneCall()

  return (
    <div
      role="group"
      aria-label="Active call"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 shadow-lg"
    >
      <span
        aria-hidden
        className="h-[7px] w-[7px] shrink-0 rounded-full bg-success motion-safe:animate-pulse"
      />
      <span className="max-w-[150px] truncate text-xs font-medium">{call.name || 'Call'}</span>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {formatCallDuration(call.seconds)}
      </span>
      <button
        type="button"
        onClick={() => controls?.toggleMute()}
        aria-pressed={call.muted}
        aria-label={call.muted ? 'Unmute call' : 'Mute call'}
        title={call.muted ? 'Unmute' : 'Mute'}
        className={cn(
          'grid h-7 w-7 shrink-0 place-items-center rounded-full border border-border transition-colors hover:bg-muted',
          call.muted ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {call.muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => controls?.hangUp()}
        aria-label="Hang up"
        title="Hang up"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-destructive text-destructive-foreground transition-opacity hover:opacity-90"
      >
        <PhoneOff className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onExpand}
        aria-label="Open active call"
        title="Open the phone"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronUp className="h-4 w-4" />
      </button>
    </div>
  )
}

/**
 * Topbar toggle. Lives here so it can read the live call from the softphone
 * context — `useAdminRail` is called above the provider in the shell.
 */
export function RailToggleButton({ rail }: { rail: AdminRailController }) {
  const { call } = useSoftphoneCall()

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
      {(call.active || call.incoming) && (
        <span
          aria-hidden="true"
          className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-success"
        />
      )}
    </Button>
  )
}
