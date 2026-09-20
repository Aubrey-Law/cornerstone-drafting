'use client'

import { FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
  ArrowUp,
  BookOpen,
  Calculator,
  CalendarDays,
  CheckCircle2,
  ClipboardCopy,
  ClipboardList,
  FileText,
  FileType2,
  HeartPulse,
  Info,
  MessageSquareText,
  NotebookPen,
  ScrollText,
  Sparkles,
  Clock3,
  Square,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { DragResizeHandle, useDragResize } from '@/components/ui/drag-resize'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabaseClient'

const DesignSheetImportDialog = dynamic(
  () => import('@/components/design-sheet/DesignSheetImportDialog').then(m => ({ default: m.DesignSheetImportDialog })),
  { ssr: false }
)
import { ChatMessage, type FloatingChatMessage, type ToolEvent } from './ChatMessage'
import { type ChatContextType, useChatContext } from './useChatContext'
import { chatNoteText, chatResponseNoteText, downloadChatAsDocx, downloadChatAsText } from './chatExport'
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
import { forEachSseFrame, toolEventFrom } from '@/app/admin/components/chatStream'
import { useConfirm } from '@/components/useConfirm'

interface ChatPanelProps {
  open: boolean
  pendingAction?: CornerstoneChatOpenDetail | null
  onPendingActionHandled?: () => void
  matterDisplayName?: string | null
  /** Resolved from `resolveFirmModel('assistant')` in the admin layout. */
  assistantModelLabel?: string | null
}

const suggestedPrompts: Record<ChatContextType['type'], string[]> = {
  matter: [
    'Plan my day',
    'Plan my week',
    "What's at risk this week?",
    'Find me 90 minutes',
    'Create a matter note for the file',
    "Summarize this client's situation",
    'Analyze MA estate tax exposure',
    'Summarize contacts and fiduciary roles',
    'Summarize the design sheet for Claude drafting',
    'Draft follow-up questions for the client',
    'Gather trust drafting details',
    'Create incapacity design sheet',
  ],
  lead: [
    "Summarize this client's situation",
    'Analyze MA estate tax exposure',
    'Draft a pre-call email for this lead',
    'Draft follow-up questions for this lead',
  ],
  general: [
    'Plan my day',
    'Plan my week',
    "What's at risk this week?",
    'Find me 90 minutes',
    "What's the MA estate tax threshold?",
    'Explain per stirpes distribution',
    'Draft a client follow-up for a stalled matter',
    'Gather trust drafting details',
    'Create incapacity design sheet',
  ],
}

/** Leading glyph for each empty-state action row; unmapped prompts fall back to Sparkles. */
const promptIcons: Record<string, LucideIcon> = {
  'Summarize the design sheet for Claude drafting': ClipboardList,
  'Analyze MA estate tax exposure': Calculator,
  'Summarize contacts and fiduciary roles': Users,
  'Create incapacity design sheet': HeartPulse,
  'Create a matter note for the file': NotebookPen,
  "Summarize this client's situation": FileText,
  'Draft follow-up questions for the client': MessageSquareText,
  'Gather trust drafting details': ScrollText,
  "What's the MA estate tax threshold?": Calculator,
  'Explain per stirpes distribution': BookOpen,
  'Draft a client follow-up for a stalled matter': MessageSquareText,
  'Plan my day': CalendarDays,
  'Plan my week': CalendarDays,
  "What's at risk this week?": Clock3,
  'Find me 90 minutes': Clock3,
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
  if (context.type === 'lead') return 'Lead context loaded'
  return 'General firm context'
}

function contextIcon(context: ChatContextType) {
  if (context.type === 'matter') return 'Matter'
  if (context.type === 'lead') return 'Lead'
  return 'Firm'
}

/** Pill text for the context strip: `Matter · Whitfield` / bare `Firm`. */
function contextPillText(context: ChatContextType, matterDisplayName?: string | null) {
  if (context.type === 'general') return contextIcon(context)
  return `${contextIcon(context)} · ${contextLabel(context, matterDisplayName)}`
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

/** Query string naming the thread the server keeps for this context. */
function historyQuery(context: ChatContextType) {
  const params = new URLSearchParams({ context_type: context.type })
  if (context.type !== 'general') params.set('context_id', context.id)
  return params.toString()
}

export function ChatPanel({
  open,
  pendingAction,
  onPendingActionHandled,
  matterDisplayName = null,
  assistantModelLabel = null,
}: ChatPanelProps) {
  const { confirm, confirmDialog } = useConfirm()
  const detectedContext = useChatContext()
  const [overrideGeneral, setOverrideGeneral] = useState(false)
  const [messages, setMessages] = useState<FloatingChatMessage[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionStatus, setActionStatus] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [savingNote, setSavingNote] = useState(false)
  const [savedNote, setSavedNote] = useState<{
    contextType: 'matter' | 'lead'
    contextId: string
    /** Matter notes only — lead notes have no type. */
    noteType?: MatterNoteSaveType
    scope: 'conversation' | 'response'
  } | null>(null)
  const [saveNoteType, setSaveNoteType] = useState<MatterNoteSaveType>('internal')
  const [designSheetProposal, setDesignSheetProposal] = useState<DesignSheetChatProposal | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composerResize = useDragResize(textareaRef, { minHeight: 40, edge: 'top' })
  const wasOpenRef = useRef(false)
  const activityDraftPromptRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Tracks which thread the current `messages` belong to, so thread switches
  // never persist one thread's messages under another thread's key.
  const loadedThreadRef = useRef<string | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const chatContext = overrideGeneral ? ({ type: 'general' } as const) : detectedContext
  const contextType = chatContext.type
  const contextId = chatContext.type === 'general' ? null : chatContext.id
  const prompts = useMemo(() => suggestedPrompts[chatContext.type], [chatContext.type])
  // Every thread is kept on the server, per attorney: matter threads are the
  // ones the Review step shares; lead threads are filed under the lead's
  // matter; the general thread is one per attorney. sessionStorage used to
  // hold general and lead threads, and lost them on reload.
  const threadKey = chatContext.type === 'general' ? 'general' : `${chatContext.type}:${chatContext.id}`

  // Isolate record threads before paint. This prevents the previous record's
  // visible turns from being submitted with a newly detected context.
  useLayoutEffect(() => {
    loadedThreadRef.current = null
    setMessages([])
    setHistoryLoading(true)
  }, [contextType, threadKey])

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      // Keep the persisted conversation; reset transient UI state only.
      setInput('')
      setError(null)
      setLoading(false)
      setOverrideGeneral(false)
      setActionStatus(null)
      setSavingNote(false)
      setSavedNote(null)
      setDesignSheetProposal(null)
    }
    wasOpenRef.current = open
  }, [open])

  useEffect(() => {
    if (!open) return
    let stale = false
    setHistoryLoading(true)
    const context = chatContext
    void (async () => {
      let loaded: FloatingChatMessage[] = []
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(`/api/admin/chat/history?${historyQuery(context)}`, {
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
            contextSnapshot: snapshotContext(context),
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
    // chatContext is derived from contextType/contextId; threadKey covers both.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextType, contextId, open, threadKey])

  useEffect(() => {
    const element = threadRef.current
    if (!element) return
    // Only follow the newest message when the reader is already at the bottom;
    // scrolling back during a stream used to be undone on the next delta.
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    if (distance > 160) return
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  // The box grows with what is typed, up to a few lines — unless the operator
  // has dragged a height of their own, which outranks the auto-sizing.
  useEffect(() => {
    if (!textareaRef.current || composerResize.height !== null) return
    textareaRef.current.style.height = 'auto'
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 112)}px`
  }, [input, composerResize.height])

  async function sendMessage(content: string) {
    let trimmed = content.trim()
    if (!trimmed || loading) return
    if (loadedThreadRef.current !== threadKey) {
      setError('This record context is still loading. Please try again.')
      return
    }

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

      await forEachSseFrame(response.body, parsed => {
        if (parsed.error && !parsed.tool) throw new Error(parsed.error)
        if (parsed.tool && parsed.tool_use_id && parsed.status) {
          sawToolEvent = true
          const toolEvent = toolEventFrom({
            tool: parsed.tool,
            tool_use_id: parsed.tool_use_id,
            status: parsed.status,
            result: parsed.result,
            error: parsed.status === 'error' ? parsed.error : undefined,
          })
          setMessages(prev => prev.map(message => {
            if (message.id !== assistantMessage.id) return message
            const existing = message.toolEvents ?? []
            const idx = existing.findIndex(event => event.toolUseId === toolEvent.toolUseId)
            const next = idx >= 0
              ? existing.map((event, i) => i === idx ? { ...event, ...toolEvent } : event)
              : [...existing, toolEvent]
            return { ...message, toolEvents: next }
          }))
          return
        }
        if (!parsed.text) return
        replyText += parsed.text
        setMessages(prev => prev.map(message =>
          message.id === assistantMessage.id
            ? { ...message, content: message.content + parsed.text }
            : message
        ))
      })
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
      // Save the pair to the attorney's server-side thread for this context.
      // Failed sends persist nothing (matches the Review step).
      if (persistReply) {
        void (async () => {
          try {
            const { data: { session } } = await supabase.auth.getSession()
            await fetch('/api/admin/chat/history', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
              },
              body: JSON.stringify({
                context_type: contextAtSend.type,
                ...(contextAtSend.type === 'general' ? {} : { context_id: contextAtSend.id }),
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

  async function postRecordNote(contextType: 'matter' | 'lead', contextId: string, content: string) {
    const { data: { session } } = await supabase.auth.getSession()
    const response = await fetch('/api/admin/chat/save-note', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({
        context_type: contextType,
        context_id: contextId,
        content,
        // Lead notes are untyped; only the matter file splits internal from
        // client communication.
        ...(contextType === 'matter' ? { note_type: saveNoteType } : {}),
      }),
    })
    if (!response.ok) {
      const json = await response.json().catch(() => null) as { error?: string } | null
      throw new Error(json?.error ?? 'Failed to save note')
    }
  }

  async function handleSaveNote() {
    if (!canSaveNote) return
    if (chatContext.type !== 'matter') return
    const content = chatNoteText(messages)
    if (!content) return

    setSavingNote(true)
    setActionStatus(null)
    setSavedNote(null)
    try {
      await postRecordNote('matter', chatContext.id, content)
      setSavedNote({ contextType: 'matter', contextId: chatContext.id, noteType: saveNoteType, scope: 'conversation' })
    } catch (err) {
      flashStatus('error', (err as Error).message || 'Failed to save note.')
    } finally {
      setSavingNote(false)
    }
  }

  /**
   * Files one assistant answer on the open record — the matter file, or the
   * lead's notes timeline. The toolbar save writes the whole thread, so the
   * single paragraph worth keeping used to arrive buried in every turn that
   * produced it.
   */
  async function handleSaveResponseAsNote(message: FloatingChatMessage): Promise<boolean> {
    if (chatContext.type === 'general') return false
    const content = chatResponseNoteText(message)
    if (!content) return false

    setActionStatus(null)
    setSavedNote(null)
    try {
      await postRecordNote(chatContext.type, chatContext.id, content)
      setSavedNote({
        contextType: chatContext.type,
        contextId: chatContext.id,
        ...(chatContext.type === 'matter' ? { noteType: saveNoteType } : {}),
        scope: 'response',
      })
      return true
    } catch (err) {
      flashStatus('error', (err as Error).message || 'Failed to save note.')
      return false
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
    const what = chatContext.type === 'matter' ? 'this matter’s' : chatContext.type === 'lead' ? 'this lead’s' : 'your general'
    if (!(await confirm({
      title: `Clear ${what} assistant chat history?`,
      body: chatContext.type === 'general'
        ? 'Your saved general conversation is removed. Matters and leads are not affected.'
        : 'The conversation is removed for everyone. Drafts and documents are not affected.',
      confirmLabel: 'Clear history',
      destructive: true,
    }))) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/admin/chat/history?${historyQuery(chatContext)}`, {
        method: 'DELETE',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      })
      if (!res.ok) throw new Error('Could not clear history')
    } catch (err) {
      flashStatus('error', (err as Error).message || 'Could not clear history.')
      return
    }
    setMessages([])
    setError(null)
    setActionStatus(null)
    setSavedNote(null)
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

  const contextWord = chatContext.type === 'matter' ? 'Matter' : chatContext.type === 'lead' ? 'Lead' : 'Firm'
  const saveAsNoteLabel = chatContext.type === 'lead'
    ? 'Save this response to the lead notes'
    : saveNoteType === 'client_comm'
      ? 'Save this response as a client communication note'
      : 'Save this response as an internal note'
  // The answer still arriving is half an answer; it gets its note action once
  // the stream ends.
  const streamingMessageId = loading ? messages.at(-1)?.id : undefined
  // "Saved to matter notes · Internal" for the matter file; a lead note has no
  // type to name.
  const savedNoteHeading = savedNote?.contextType === 'lead'
    ? 'Saved to lead notes'
    : `Saved to matter notes · ${savedNote?.noteType === 'client_comm' ? 'Client comm.' : 'Internal'}`
  const savedNoteRecord = savedNote?.contextType === 'lead' ? 'lead' : 'matter file'
  const savedNoteHref = savedNote
    ? savedNote.contextType === 'lead'
      ? `/admin/leads/${savedNote.contextId}?tab=notes`
      : `/admin/matters/${savedNote.contextId}?tab=notes`
    : ''

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-card-foreground">
      {confirmDialog}
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

      {/* Context strip — what the assistant is answering about, and the escape hatch. */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span
          className={cn(
            'inline-flex min-w-0 items-center rounded-full px-2 py-1 text-micro font-semibold',
            chatContext.type === 'general'
              ? 'bg-muted text-muted-foreground'
              : 'bg-primary text-primary-foreground',
          )}
        >
          <span className="truncate">{contextPillText(chatContext, matterDisplayName)}</span>
        </span>
        {detectedContext.type !== 'general' && !overrideGeneral && (
          <button
            type="button"
            onClick={() => setOverrideGeneral(true)}
            className="shrink-0 whitespace-nowrap rounded-sm text-micro font-semibold text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Switch to general
          </button>
        )}
      </div>

      {hasContent && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border bg-background/40 px-3 py-2">
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
                      'inline-flex h-6 items-center rounded-full px-2 text-micro font-semibold transition-colors',
                      saveNoteType === option.key
                        ? option.key === 'internal'
                          ? 'bg-brand-navy text-white'
                          : 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-accent',
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
                className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-2 text-micro font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <NotebookPen size={12} />
                {savingNote ? 'Saving…' : 'Save to matter notes'}
              </button>
            </>
          )}
          {lastAssistantMessage && (
            <button
              type="button"
              onClick={() => void handleCopyLastResponse()}
              className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-2 text-micro font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ClipboardCopy size={12} />
              Copy last response
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleExportDocx()}
            disabled={!hasContent}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-2 text-micro font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FileType2 size={12} />
            Export as Word
          </button>
          <button
            type="button"
            onClick={handleExportText}
            disabled={!hasContent}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-2 text-micro font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FileText size={12} />
            Export as text
          </button>
          <button
            type="button"
            onClick={() => void handleClearConversation()}
            disabled={loading}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-2 text-micro font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trash2 size={12} />
            Clear chat
          </button>
          {actionStatus && (
            <span
              role="status"
              className={cn(
                'ml-auto text-micro font-medium',
                actionStatus.kind === 'success' ? 'text-green' : 'text-destructive',
              )}
            >
              {actionStatus.text}
            </span>
          )}
        </div>
      )}

      <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {historyLoading && messages.length === 0 ? (
          <div className="text-sm leading-relaxed text-muted-foreground">Loading history…</div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col justify-end">
            <p className="text-sm font-semibold text-foreground">What can I help you with?</p>
            <ul className="mt-2">
              {prompts.map((prompt, index) => {
                const PromptIcon = promptIcons[prompt] ?? Sparkles
                return (
                  <li key={prompt}>
                    <button
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
                      className={cn(
                        'flex w-full items-center gap-2 py-2 text-left text-sm text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        index < prompts.length - 1 && 'border-b border-muted',
                      )}
                    >
                      <PromptIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                      <span className="min-w-0 flex-1">{prompt}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          messages.map(message => (
            <ChatMessage
              key={message.id}
              message={message}
              onReviewDesignSheetImport={handleReviewDesignSheetImport}
              onSaveAsNote={
                chatContext.type !== 'general' && message.id !== streamingMessageId
                  ? handleSaveResponseAsNote
                  : undefined
              }
              saveAsNoteLabel={saveAsNoteLabel}
            />
          ))
        )}

        {loading && (
          <div className="flex gap-1 px-1 pt-1.5" aria-label="Assistant is typing">
            {[0, 1, 2].map(index => (
              <span
                key={index}
                className="h-1.5 w-1.5 rounded-full bg-primary"
                style={{ animation: 'cornerstone-chat-pulse 1s ease-in-out infinite', animationDelay: `${index * 120}ms` }}
              />
            ))}
          </div>
        )}

        {error && (
          <div className="mt-2.5 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-compact text-destructive">
            {error}
          </div>
        )}

        {savedNote && (
          <div
            role="status"
            className="mt-2.5 rounded-lg border border-green bg-green-bg px-3 py-2.5 text-compact text-green"
          >
            <div className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              {savedNoteHeading}
            </div>
            <p className="mt-1 text-xs opacity-90">
              {savedNote.scope === 'response'
                ? `This response is now part of the ${savedNoteRecord} and shows in the notes timeline.`
                : `This conversation is now part of the ${savedNoteRecord} and shows in the notes timeline.`}
            </p>
            <Link
              href={savedNoteHref}
              className="mt-1.5 inline-block text-xs font-semibold underline underline-offset-2"
            >
              View
            </Link>
          </div>
        )}
      </div>

      {/* Model + context provenance, immediately above the composer. */}
      {assistantModelLabel ? (
        <div className="flex shrink-0 items-start gap-1.5 border-t border-amber-border bg-amber-bg px-3 py-1.5 text-micro text-amber">
          <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span>{assistantModelLabel} · {contextWord} context loaded · answers are drafts, not filed advice</span>
        </div>
      ) : (
        <div className="flex shrink-0 items-start gap-1.5 border-t border-destructive/25 bg-destructive/10 px-3 py-1.5 text-micro text-destructive">
          <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span>No assistant model is configured for this workspace.</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex shrink-0 items-end gap-2 border-t border-border bg-card p-3"
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <DragResizeHandle
            controls={composerResize}
            label="Resize the message box"
            edge="top"
            className="rounded-t-md border-x border-t border-input bg-muted"
          />
          <textarea
            ref={textareaRef}
            style={composerResize.height === null ? undefined : { height: composerResize.height, maxHeight: 'none' }}
            value={input}
            onChange={event => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              chatContext.type === 'matter'
                ? 'Ask about this matter...'
                : chatContext.type === 'lead'
                  ? 'Ask about this lead...'
                  : 'Ask anything...'
            }
            rows={1}
            className="h-10 max-h-28 min-h-10 w-full resize-none overflow-y-auto rounded-md rounded-t-none border border-input bg-background px-3 py-2.5 text-sm leading-snug text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>
        {loading ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            aria-label="Stop generating"
            title="Stop generating"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label="Send message"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
    </div>
  )
}
