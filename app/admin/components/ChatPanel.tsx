'use client'

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { ArrowUp, ClipboardCopy, FileText, FileType2, NotebookPen, Square, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabaseClient'

const DesignSheetImportDialog = dynamic(
  () => import('@/components/design-sheet/DesignSheetImportDialog').then(m => ({ default: m.DesignSheetImportDialog })),
  { ssr: false }
)
import { ChatMessage, type FloatingChatMessage, type ToolEvent } from './ChatMessage'
import { type ChatContextType, useChatContext } from './useChatContext'
import { chatNoteText, downloadChatAsDocx, downloadChatAsText } from './chatExport'
import {
  MATTER_CLIENT_COMM_ACTIVITY_NOTE_PROMPT,
  MATTER_INTERNAL_ACTIVITY_NOTE_PROMPT,
  MATTER_NOTE_ASSISTANT_PROMPT,
  type CornerstoneChatOpenDetail,
  type MatterNoteSaveType,
} from './adminChatEvents'
import type {
  DesignSheetImportPreviewRow,
  DesignSheetImportProposal,
} from '@/lib/designSheetImport/shared'

interface ChatPanelProps {
  open: boolean
  onClose: () => void
  pendingAction?: CornerstoneChatOpenDetail | null
  onPendingActionHandled?: () => void
  matterDisplayName?: string | null
}

const ASSISTANT_TITLE = process.env.NEXT_PUBLIC_FIRM_NAME
  ? `${process.env.NEXT_PUBLIC_FIRM_NAME} Assistant`
  : 'AI Assistant'

const suggestedPrompts: Record<ChatContextType['type'], string[]> = {
  matter: [
    'Create a matter note for the file',
    "Summarize this client's situation",
    'Analyze MA estate tax exposure',
    'Summarize contacts and fiduciary roles',
    'Summarize the design sheet for Claude drafting',
    'Draft follow-up questions for the client',
    'Gather trust drafting details',
    'Create incapacity design sheet',
  ],
  general: [
    "What's the MA estate tax threshold?",
    'Explain per stirpes distribution',
    'Draft a client follow-up for a stalled matter',
    'Gather trust drafting details',
    'Create incapacity design sheet',
  ],
}

type DesignSheetChatProposal = {
  matterId: string
  preview: DesignSheetImportPreviewRow[]
  proposed: DesignSheetImportProposal
}

function resolveSuggestedPrompt(prompt: string): { text: string; noteType?: MatterNoteSaveType; send?: boolean; prefill?: string } {
  if (prompt === 'Create a matter note for the file') {
    return { text: MATTER_NOTE_ASSISTANT_PROMPT, noteType: 'internal', send: true }
  }
  if (prompt === 'Log client email and follow-up') {
    return { text: MATTER_CLIENT_COMM_ACTIVITY_NOTE_PROMPT, noteType: 'client_comm', prefill: 'Sent email to client about: [topic]. Follow up in: [timing].' }
  }
  if (prompt === 'Log internal activity and follow-up') {
    return { text: MATTER_INTERNAL_ACTIVITY_NOTE_PROMPT, noteType: 'internal', prefill: 'Activity: [what happened]. Follow up in: [timing].' }
  }
  return { text: prompt, send: true }
}

function snapshotContext(context: ChatContextType) {
  return context.type === 'general'
    ? { type: context.type }
    : { type: context.type, id: context.id }
}

function contextLabel(context: ChatContextType, matterDisplayName?: string | null) {
  if (context.type === 'matter') {
    return matterDisplayName?.trim() || 'Matter context loaded'
  }
  return 'General firm context'
}

function contextIcon(context: ChatContextType) {
  if (context.type === 'matter') return 'Matter'
  return 'Firm'
}

function makeMessage(role: FloatingChatMessage['role'], content: string, context: ChatContextType): FloatingChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    timestamp: new Date().toISOString(),
    contextSnapshot: snapshotContext(context),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Conversation survives close/reopen within the browser session.
const CHAT_STORAGE_KEY = 'cornerstone-admin-chat-messages'

function loadStoredMessages(): FloatingChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(CHAT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((m): m is FloatingChatMessage =>
      isRecord(m) &&
      typeof m.id === 'string' &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' &&
      typeof m.timestamp === 'string',
    )
  } catch {
    return []
  }
}

function storeMessages(messages: FloatingChatMessage[]) {
  try {
    if (messages.length === 0) {
      window.sessionStorage.removeItem(CHAT_STORAGE_KEY)
    } else {
      window.sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages))
    }
  } catch {
    // sessionStorage may be unavailable (private mode, quota) — chat still works.
  }
}

export function ChatPanel({ open, onClose, pendingAction, onPendingActionHandled, matterDisplayName = null }: ChatPanelProps) {
  const detectedContext = useChatContext()
  const [overrideGeneral, setOverrideGeneral] = useState(false)
  const [messages, setMessages] = useState<FloatingChatMessage[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionStatus, setActionStatus] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [savingNote, setSavingNote] = useState(false)
  const [saveNoteType, setSaveNoteType] = useState<MatterNoteSaveType>('internal')
  const [designSheetProposal, setDesignSheetProposal] = useState<DesignSheetChatProposal | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const wasOpenRef = useRef(false)
  const activityDraftPromptRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Tracks which thread the current `messages` belong to, so thread switches
  // never persist one thread's messages under another thread's key.
  const loadedThreadRef = useRef<string | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const chatContext = overrideGeneral ? ({ type: 'general' } as const) : detectedContext
  const prompts = useMemo(() => suggestedPrompts[chatContext.type], [chatContext.type])
  // Matter threads are shared with the Draft assistant via matter_assistant_messages;
  // the general thread stays in sessionStorage.
  const threadKey = chatContext.type === 'matter' ? chatContext.id : 'general'

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      // Keep the persisted conversation; reset transient UI state only.
      setInput('')
      setError(null)
      setLoading(false)
      setOverrideGeneral(false)
      setActionStatus(null)
      setSavingNote(false)
      setDesignSheetProposal(null)
    }
    wasOpenRef.current = open
  }, [open])

  useEffect(() => {
    if (!open) return
    if (threadKey === 'general') {
      setMessages(loadStoredMessages())
      loadedThreadRef.current = 'general'
      return
    }
    let stale = false
    setHistoryLoading(true)
    void (async () => {
      let loaded: FloatingChatMessage[] = []
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(`/api/admin/matters/${threadKey}/assistant`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        })
        const body = await res.json().catch(() => ({})) as {
          turns?: Array<{ role: string; content: string; createdAt?: string }>
        }
        if (res.ok && Array.isArray(body.turns)) {
          loaded = body.turns.map((turn, index) => ({
            id: `srv-${threadKey}-${index}`,
            role: turn.role === 'user' ? 'user' as const : 'assistant' as const,
            content: turn.content,
            timestamp: turn.createdAt ?? new Date().toISOString(),
            contextSnapshot: { type: 'matter', id: threadKey },
          }))
        }
      } catch {
        // Chat still works without the persisted view.
      }
      if (stale) return
      setMessages(loaded)
      loadedThreadRef.current = threadKey
      setHistoryLoading(false)
    })()
    return () => {
      stale = true
    }
  }, [open, threadKey])

  useEffect(() => {
    if (threadKey !== 'general' || loadedThreadRef.current !== 'general') return
    storeMessages(messages)
  }, [messages, threadKey])

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (!textareaRef.current) return
    textareaRef.current.style.height = 'auto'
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 112)}px`
  }, [input])

  async function sendMessage(content: string) {
    let trimmed = content.trim()
    if (!trimmed || loading) return

    if (activityDraftPromptRef.current) {
      trimmed = `${activityDraftPromptRef.current}\n\nDetails: ${trimmed}`
      activityDraftPromptRef.current = null
    }

    const contextAtSend = chatContext
    const userMessage = makeMessage('user', trimmed, contextAtSend)
    const assistantMessage = makeMessage('assistant', '', contextAtSend)
    const nextMessages = [...messages, userMessage]

    setMessages([...nextMessages, assistantMessage])
    setInput('')
    setError(null)
    setLoading(true)
    const controller = new AbortController()
    abortRef.current = controller
    let replyText = ''
    let sawToolEvent = false
    let persistReply: string | null = null

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch('/api/admin/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          messages: nextMessages.map(message => ({
            role: message.role,
            content: message.content,
          })),
          context_type: contextAtSend.type,
          context_id: contextAtSend.type === 'general' ? undefined : contextAtSend.id,
        }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const json = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(json?.error ?? 'Chat unavailable - try again in a moment.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const event of events) {
          const dataLines = event
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trim())

          for (const dataLine of dataLines) {
            if (!dataLine || dataLine === '[DONE]') continue
            const parsed = JSON.parse(dataLine) as {
              text?: string
              error?: string
              tool?: string
              tool_use_id?: string
              status?: 'running' | 'done' | 'error'
              result?: {
                filename?: string
                signed_url?: string
                total_claim?: number
                matter_id?: string
                preview?: unknown
                proposed?: unknown
                task_id?: string
                title?: string
                target?: 'matter' | 'lead'
              }
            }
            if (parsed.error && !parsed.tool) throw new Error(parsed.error)
            if (parsed.tool && parsed.tool_use_id && parsed.status) {
              sawToolEvent = true
              const preview = Array.isArray(parsed.result?.preview)
                ? parsed.result.preview as DesignSheetImportPreviewRow[]
                : undefined
              const proposed = isRecord(parsed.result?.proposed)
                ? parsed.result.proposed as DesignSheetImportProposal
                : undefined
              const toolEvent = {
                tool: parsed.tool,
                toolUseId: parsed.tool_use_id,
                status: parsed.status,
                filename: parsed.result?.filename,
                signedUrl: parsed.result?.signed_url,
                totalClaim: parsed.result?.total_claim,
                matterId: parsed.result?.matter_id,
                taskId: parsed.result?.task_id,
                taskTitle: parsed.result?.title,
                preview,
                proposed,
                error: parsed.status === 'error' ? parsed.error : undefined,
              }
              setMessages(prev => prev.map(message => {
                if (message.id !== assistantMessage.id) return message
                const existing = message.toolEvents ?? []
                const idx = existing.findIndex(event => event.toolUseId === toolEvent.toolUseId)
                const next = idx >= 0
                  ? existing.map((event, i) => i === idx ? { ...event, ...toolEvent } : event)
                  : [...existing, toolEvent]
                return { ...message, toolEvents: next }
              }))
              continue
            }
            if (!parsed.text) continue
            replyText += parsed.text
            setMessages(prev => prev.map(message =>
              message.id === assistantMessage.id
                ? { ...message, content: message.content + parsed.text }
                : message
            ))
          }
        }
      }
      persistReply = replyText || (sawToolEvent ? '[Prepared a design sheet proposal for review]' : null)
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // User stopped generation: keep any partial text, drop an empty bubble.
        setMessages(prev => prev.filter(item => !(item.id === assistantMessage.id && !item.content && !item.toolEvents?.length)))
        persistReply = replyText || null
      } else {
        const message = (err as Error).message || 'Chat unavailable - try again in a moment.'
        setError(message)
        setMessages(prev => prev.map(item =>
          item.id === assistantMessage.id && !item.content
            ? { ...item, content: `Error: ${message}` }
            : item
        ))
      }
    } finally {
      abortRef.current = null
      setLoading(false)
      // Share matter conversations with the Draft assistant's per-matter
      // thread. Failed sends persist nothing (matches Draft assistant).
      if (contextAtSend.type === 'matter' && persistReply) {
        void (async () => {
          try {
            const { data: { session } } = await supabase.auth.getSession()
            await fetch(`/api/admin/matters/${contextAtSend.id}/assistant`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
              },
              body: JSON.stringify({
                turns: [
                  { role: 'user', content: trimmed },
                  { role: 'assistant', content: persistReply },
                ],
              }),
            })
          } catch {
            // Best-effort: the local thread already shows the turn.
          }
        })()
      }
    }
  }

  useEffect(() => {
    if (!open || !pendingAction) return
    onPendingActionHandled?.()
    if (pendingAction.noteType) setSaveNoteType(pendingAction.noteType)
    if (pendingAction.send && pendingAction.prompt) {
      void sendMessage(pendingAction.prompt)
      return
    }
    if (pendingAction.prefill && pendingAction.prompt) {
      activityDraftPromptRef.current = pendingAction.prompt
      setInput(pendingAction.prefill)
      textareaRef.current?.focus()
      return
    }
    if (pendingAction.prompt) {
      setInput(pendingAction.prompt)
      textareaRef.current?.focus()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per pendingAction from parent
  }, [open, pendingAction])

  const hasContent = messages.some(message => message.content.trim().length > 0)
  const canSaveNote = chatContext.type === 'matter' && hasContent && !savingNote
  const exportBaseName = `cornerstone-chat-${new Date().toISOString().slice(0, 10)}`

  function flashStatus(kind: 'success' | 'error', text: string) {
    setActionStatus({ kind, text })
    window.setTimeout(() => {
      setActionStatus(prev => (prev && prev.text === text ? null : prev))
    }, 4000)
  }

  async function handleSaveNote() {
    if (!canSaveNote) return
    if (chatContext.type !== 'matter') return
    const content = chatNoteText(messages)
    if (!content) return

    setSavingNote(true)
    setActionStatus(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch('/api/admin/chat/save-note', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          context_type: chatContext.type,
          context_id: chatContext.id,
          content,
          ...(chatContext.type === 'matter' ? { note_type: saveNoteType } : {}),
        }),
      })
      if (!response.ok) {
        const json = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(json?.error ?? 'Failed to save note')
      }
      const savedAs = saveNoteType === 'client_comm' ? 'matter client comm.' : 'matter internal'
      flashStatus('success', `Saved chat to ${savedAs} notes.`)
    } catch (err) {
      flashStatus('error', (err as Error).message || 'Failed to save note.')
    } finally {
      setSavingNote(false)
    }
  }

  function handleExportText() {
    if (!hasContent) return
    try {
      downloadChatAsText(messages, exportBaseName)
      flashStatus('success', 'Exported chat as text file.')
    } catch (err) {
      flashStatus('error', (err as Error).message || 'Export failed.')
    }
  }

  async function handleExportDocx() {
    if (!hasContent) return
    try {
      await downloadChatAsDocx(messages, exportBaseName)
      flashStatus('success', 'Exported chat as Word document.')
    } catch (err) {
      flashStatus('error', (err as Error).message || 'Export failed.')
    }
  }

  const lastAssistantMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]
      if (message.role === 'assistant' && message.content.trim()) return message.content
    }
    return null
  }, [messages])

  async function handleCopyLastResponse() {
    if (!lastAssistantMessage) return
    try {
      await navigator.clipboard.writeText(lastAssistantMessage)
      flashStatus('success', 'Copied last response.')
    } catch {
      flashStatus('error', 'Could not copy to clipboard.')
    }
  }

  async function handleClearConversation() {
    if (chatContext.type === 'matter') {
      if (!window.confirm('Clear this matter’s assistant chat history?')) return
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(`/api/admin/matters/${chatContext.id}/assistant`, {
          method: 'DELETE',
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        })
        if (!res.ok) throw new Error('Could not clear history')
      } catch (err) {
        flashStatus('error', (err as Error).message || 'Could not clear history.')
        return
      }
    }
    setMessages([])
    setError(null)
    setActionStatus(null)
    setDesignSheetProposal(null)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void sendMessage(input)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (!event.shiftKey || event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void sendMessage(input)
    }
  }

  function handleReviewDesignSheetImport(event: ToolEvent) {
    if (!event.matterId || !event.preview?.length || !event.proposed) {
      flashStatus('error', 'No design sheet proposal is available to review.')
      return
    }

    setDesignSheetProposal({
      matterId: event.matterId,
      preview: event.preview,
      proposed: event.proposed,
    })
  }

  return (
    <aside
      aria-label={ASSISTANT_TITLE}
      aria-hidden={!open}
      className={cn(
        'fixed bottom-0 right-0 top-0 z-[49] flex w-[min(420px,100vw)] flex-col border-l border-border bg-card text-card-foreground shadow-[-4px_0_24px_rgba(0,0,0,0.12)] transition-transform duration-200 ease-out',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      {designSheetProposal && (
        <DesignSheetImportDialog
          open={Boolean(designSheetProposal)}
          onOpenChange={nextOpen => {
            if (!nextOpen) setDesignSheetProposal(null)
          }}
          matterId={designSheetProposal.matterId}
          allowUpload={false}
          initialPreview={designSheetProposal.preview}
          initialProposed={designSheetProposal.proposed}
          onAccepted={() => {
            setDesignSheetProposal(null)
            flashStatus('success', 'Design sheet updates saved.')
          }}
        />
      )}
      <div className="flex min-h-[72px] items-center justify-between gap-4 border-b border-border px-4 py-3">
        <div>
          <div className="admin-section-title text-foreground">
            {ASSISTANT_TITLE}
          </div>
          <div
            className={cn(
              'mt-2 inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold',
              chatContext.type === 'general'
                ? 'bg-muted text-muted-foreground'
                : 'bg-accent text-accent-foreground',
            )}
          >
            {contextIcon(chatContext)} · {contextLabel(chatContext, matterDisplayName)}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI assistant"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X size={18} />
        </button>
      </div>

      {detectedContext.type !== 'general' && !overrideGeneral && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/50 px-4 py-2.5 text-[13px] text-foreground">
          <span>Answering about: {detectedContext.label}</span>
          <button
            type="button"
            onClick={() => setOverrideGeneral(true)}
            className="whitespace-nowrap rounded-sm text-[13px] font-semibold text-accent transition-colors hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Switch to general
          </button>
        </div>
      )}

      {hasContent && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background/40 px-4 py-2">
          {chatContext.type === 'matter' && (
            <>
              <div className="flex gap-1" role="group" aria-label="Note type when saving">
                {([
                  { key: 'internal' as const, label: 'Internal' },
                  { key: 'client_comm' as const, label: 'Client comm.' },
                ]).map(option => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setSaveNoteType(option.key)}
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors',
                      saveNoteType === option.key
                        ? option.key === 'internal'
                          ? 'bg-brand-navy text-white'
                          : 'bg-accent text-white'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void handleSaveNote()}
                disabled={!canSaveNote}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <NotebookPen size={14} />
                {savingNote ? 'Saving…' : 'Save to matter notes'}
              </button>
            </>
          )}
          {lastAssistantMessage && (
            <button
              type="button"
              onClick={() => void handleCopyLastResponse()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ClipboardCopy size={14} />
              Copy last response
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleExportDocx()}
            disabled={!hasContent}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FileType2 size={14} />
            Export as Word
          </button>
          <button
            type="button"
            onClick={handleExportText}
            disabled={!hasContent}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FileText size={14} />
            Export as text
          </button>
          <button
            type="button"
            onClick={() => void handleClearConversation()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trash2 size={14} />
            Clear chat
          </button>
          {actionStatus && (
            <span
              role="status"
              className={cn(
                'ml-auto text-[11px] font-medium',
                actionStatus.kind === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
              )}
            >
              {actionStatus.text}
            </span>
          )}
        </div>
      )}

      <div
        ref={threadRef}
        className="flex-1 overflow-y-auto bg-card px-4 py-4"
      >
        {historyLoading && messages.length === 0 ? (
          <div className="text-sm leading-relaxed text-muted-foreground">Loading history…</div>
        ) : messages.length === 0 ? (
          <div className="text-sm leading-relaxed text-muted-foreground">
            Ask me anything about this matter, your pipeline, or Massachusetts estate planning.
          </div>
        ) : (
          messages.map(message => (
            <ChatMessage
              key={message.id}
              message={message}
              onReviewDesignSheetImport={handleReviewDesignSheetImport}
            />
          ))
        )}

        {loading && (
          <div className="flex gap-1 px-1 pt-1.5" aria-label="Assistant is typing">
            {[0, 1, 2].map(index => (
              <span
                key={index}
                className="h-1.5 w-1.5 rounded-full bg-accent"
                style={{ animation: 'cornerstone-chat-pulse 1s ease-in-out infinite', animationDelay: `${index * 120}ms` }}
              />
            ))}
          </div>
        )}

        {error && (
          <div className="mt-2.5 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            {error}
          </div>
        )}

        {!historyLoading && messages.length === 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {prompts.map(prompt => (
              <button
                key={prompt}
                type="button"
                onClick={() => {
                  const resolved = resolveSuggestedPrompt(prompt)
                  if (resolved.noteType) setSaveNoteType(resolved.noteType)
                  if (resolved.send !== false && !resolved.prefill) {
                    void sendMessage(resolved.text)
                    return
                  }
                  if (resolved.prefill) {
                    activityDraftPromptRef.current = resolved.text
                    setInput(resolved.prefill)
                    textareaRef.current?.focus()
                    return
                  }
                  setInput(resolved.text)
                  textareaRef.current?.focus()
                }}
                className="rounded-full border border-border bg-muted px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex min-h-[72px] items-end gap-2.5 border-t border-border bg-card p-3"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={event => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={chatContext.type === 'matter' ? 'Ask about this matter...' : 'Ask anything...'}
          rows={1}
          className="max-h-28 flex-1 resize-none overflow-y-auto rounded-md border border-input bg-background px-3 py-2.5 text-sm leading-snug text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        {loading ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            aria-label="Stop generating"
            title="Stop generating"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label="Send message"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowUp size={18} />
          </button>
        )}
      </form>
      <style>{`
        @keyframes cornerstone-chat-pulse {
          0%, 100% { transform: translateY(0); opacity: 0.35; }
          50% { transform: translateY(-3px); opacity: 0.9; }
        }
      `}</style>
    </aside>
  )
}
