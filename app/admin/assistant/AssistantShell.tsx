'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { ChatHistorySidebar, type AssistantChatSummary } from './components/ChatHistorySidebar'
import { AssistantComposer } from './components/AssistantComposer'
import { AssistantContextPicker, type AssistantContext } from './components/AssistantContextPicker'
import { AssistantThread } from './components/AssistantThread'
import { AdminPageShell } from '@/components/layout/AdminPageShell'
import {
  messagesFromPersisted,
  useAssistantStream,
  type AssistantMessage,
  type WorkflowRef,
} from './components/useAssistantStream'

const PENDING_MESSAGE_KEY = 'assistant:pending'

const SUGGESTED_PROMPTS = [
  'Plan my day — what needs attention across my matters?',
  'Draft a follow-up email to a client',
  'Gather trust drafting details',
  'Create incapacity design sheet',
  'What workflows are in the library?',
]

interface PendingMessage {
  chatId: string
  content: string
  workflow: WorkflowRef | null
}

interface ChatContextPayload {
  type: 'general' | 'matter' | 'lead'
  id: string | null
  label: string | null
}

function contextFromPayload(payload: ChatContextPayload | undefined): AssistantContext {
  if (!payload || payload.type === 'general' || !payload.id) return { type: 'general' }
  return { type: payload.type, id: payload.id, label: payload.label ?? (payload.type === 'lead' ? 'Lead' : 'Matter') }
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'Content-Type': 'application/json',
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

function makeLocalId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

interface AssistantShellProps {
  chatId?: string
}

export function AssistantShell({ chatId }: AssistantShellProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { send, stop, streaming } = useAssistantStream()

  const [chats, setChats] = useState<AssistantChatSummary[]>([])
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [loadingChat, setLoadingChat] = useState(Boolean(chatId))
  const [input, setInput] = useState('')
  const [workflow, setWorkflow] = useState<WorkflowRef | null>(null)
  const [context, setContext] = useState<AssistantContext>({ type: 'general' })
  const [contextPickerOpen, setContextPickerOpen] = useState(false)
  const pendingHandledRef = useRef(false)

  const loadChats = useCallback(async () => {
    const response = await fetch('/api/admin/assistant/chats', { headers: await authHeaders(), cache: 'no-store' })
    const body = await response.json().catch(() => ({})) as { chats?: AssistantChatSummary[]; error?: string }
    if (response.ok) setChats(body.chats ?? [])
  }, [])

  useEffect(() => { void loadChats() }, [loadChats])

  // Deep link from the Library's Template Builder: pre-fill the first message
  // with the upload tag so the assistant can pick up the file immediately.
  useEffect(() => {
    const uploadId = searchParams.get('templateUpload')
    if (!uploadId || chatId) return
    const uploadName = searchParams.get('templateUploadName')
    setInput(
      `[Template upload: ${uploadId}]\n\nI uploaded ${uploadName ? `"${uploadName}"` : 'a Word document'}. ` +
      'Analyze it and help me turn it into a document template.',
    )
  }, [searchParams, chatId])

  // Deep link from a record page: /admin/assistant?matter=<id> or ?lead=<id>
  // opens the new chat pointed at that record.
  useEffect(() => {
    const matterId = searchParams.get('matter')
    const leadId = searchParams.get('lead')
    const recordId = matterId ?? leadId
    if (!recordId || chatId) return
    const type = matterId ? 'matter' as const : 'lead' as const
    setContext({ type, id: recordId, label: type === 'lead' ? 'Lead' : 'Matter' })
    let cancelled = false
    void (async () => {
      const response = await fetch(`/api/admin/assistant/records?id=${encodeURIComponent(recordId)}`, { headers: await authHeaders(), cache: 'no-store' })
      const body = await response.json().catch(() => ({})) as { record?: { type: 'matter' | 'lead'; label: string }; error?: string }
      if (cancelled) return
      if (response.ok && body.record) setContext({ type: body.record.type, id: recordId, label: body.record.label })
      else toast.error(body.error ?? 'That matter could not be found')
    })()
    return () => { cancelled = true }
  }, [searchParams, chatId])

  // Deep link from the Library: /admin/assistant?workflow=<id> pre-attaches it.
  useEffect(() => {
    const workflowId = searchParams.get('workflow')
    if (!workflowId || chatId) return
    let cancelled = false
    void (async () => {
      const response = await fetch(`/api/admin/works/${workflowId}`, { headers: await authHeaders(), cache: 'no-store' })
      const body = await response.json().catch(() => ({})) as { skill?: { id: string; name: string; allowed_context?: string[] }; error?: string }
      if (cancelled) return
      if (response.ok && body.skill) {
        const matterScoped = Array.isArray(body.skill.allowed_context) && body.skill.allowed_context.includes('matter')
        setWorkflow({ id: body.skill.id, title: body.skill.name, matterScoped })
        if (matterScoped && !searchParams.get('matter') && !searchParams.get('lead')) setContextPickerOpen(true)
      }
      else toast.error(body.error ?? 'Workflow not found')
    })()
    return () => { cancelled = true }
  }, [searchParams, chatId])

  /** Re-read a chat from the server. Used after a stop, so what is on screen is
   *  exactly what was persisted. */
  const reloadMessages = useCallback(async (targetChatId: string) => {
    const response = await fetch(`/api/admin/assistant/chats/${targetChatId}`, {
      headers: await authHeaders(),
      cache: 'no-store',
    })
    const body = await response.json().catch(() => ({})) as {
      messages?: Parameters<typeof messagesFromPersisted>[0]
      context?: ChatContextPayload
    }
    if (response.ok) {
      setMessages(messagesFromPersisted(body.messages ?? []))
      setContext(contextFromPayload(body.context))
    }
  }, [])

  const streamInto = useCallback(async (targetChatId: string, content: string, attachedWorkflow: WorkflowRef | null) => {
    const userMessage: AssistantMessage = {
      id: makeLocalId(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
      workflowAttached: attachedWorkflow ?? undefined,
    }
    const assistantMessage: AssistantMessage = {
      id: makeLocalId(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userMessage, assistantMessage])

    try {
      const result = await send(targetChatId, { content, workflow: attachedWorkflow }, {
        onDelta: text => setMessages(prev => prev.map(message =>
          message.id === assistantMessage.id ? { ...message, content: message.content + text } : message,
        )),
        onToolEvent: event => setMessages(prev => prev.map(message => {
          if (message.id !== assistantMessage.id) return message
          const existing = message.toolEvents ?? []
          const idx = existing.findIndex(candidate => candidate.toolUseId === event.toolUseId)
          const next = idx >= 0
            ? existing.map((candidate, i) => i === idx ? { ...candidate, ...event } : candidate)
            : [...existing, event]
          return { ...message, toolEvents: next }
        })),
        onWorkflowApplied: applied => setMessages(prev => prev.map(message =>
          message.id === assistantMessage.id ? { ...message, workflowApplied: applied } : message,
        )),
      })
      if (result.aborted) {
        // The server keeps what it already generated. Re-read so the thread
        // shows the persisted answer rather than the truncated one on screen.
        await reloadMessages(targetChatId)
      }
    } catch (error) {
      const detail = (error as Error).message || 'Assistant unavailable - try again in a moment.'
      toast.error(detail, {
        action: {
          label: 'Retry',
          onClick: () => { void streamIntoRef.current?.(targetChatId, content, attachedWorkflow) },
        },
      })
      setMessages(prev => prev.map(message =>
        message.id === assistantMessage.id && !message.content
          ? { ...message, content: `Error: ${detail}` }
          : message,
      ))
    } finally {
      void loadChats()
    }
  }, [send, loadChats, reloadMessages])

  // Retry re-enters the same function; a ref keeps the callback identity stable.
  const streamIntoRef = useRef<typeof streamInto | null>(null)
  useEffect(() => { streamIntoRef.current = streamInto }, [streamInto])

  // Load an existing chat's history; then fire any pending first message
  // handed off from the initial view.
  useEffect(() => {
    if (!chatId) {
      setMessages([])
      setLoadingChat(false)
      // A fresh page starts general unless a deep link set the record.
      if (!searchParams.get('matter') && !searchParams.get('lead')) setContext({ type: 'general' })
      return
    }
    let cancelled = false
    setLoadingChat(true)
    void (async () => {
      const response = await fetch(`/api/admin/assistant/chats/${chatId}`, { headers: await authHeaders(), cache: 'no-store' })
      const body = await response.json().catch(() => ({})) as {
        messages?: Parameters<typeof messagesFromPersisted>[0]
        context?: ChatContextPayload
        error?: string
      }
      if (cancelled) return
      if (!response.ok) {
        toast.error(body.error ?? 'Unable to load chat')
        router.push('/admin/assistant')
        return
      }
      setMessages(messagesFromPersisted(body.messages ?? []))
      setContext(contextFromPayload(body.context))
      setLoadingChat(false)

      if (!pendingHandledRef.current) {
        pendingHandledRef.current = true
        try {
          const raw = sessionStorage.getItem(PENDING_MESSAGE_KEY)
          if (raw) {
            const pending = JSON.parse(raw) as PendingMessage
            if (pending.chatId === chatId) {
              sessionStorage.removeItem(PENDING_MESSAGE_KEY)
              void streamInto(chatId, pending.content, pending.workflow)
            }
          }
        } catch {
          sessionStorage.removeItem(PENDING_MESSAGE_KEY)
        }
      }
    })()
    return () => { cancelled = true }
    // streamInto is stable per chat; intentionally keyed on chatId only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, router])

  /** Attach a workflow; a matter-scoped one in a general chat opens the record picker at once. */
  function handleWorkflowChange(next: WorkflowRef | null) {
    setWorkflow(next)
    if (next?.matterScoped && context.type === 'general') setContextPickerOpen(true)
  }

  /** Point this chat (or the one about to be created) at a record. */
  async function handleContextChange(next: AssistantContext) {
    const previous = context
    setContext(next)
    if (!chatId) return
    const response = await fetch(`/api/admin/assistant/chats/${chatId}`, {
      method: 'PATCH',
      headers: await authHeaders(),
      body: JSON.stringify(next.type === 'general'
        ? { context_type: 'general' }
        : { context_type: next.type, context_id: next.id }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      toast.error(body.error ?? 'Unable to change what this chat is about')
      setContext(previous)
      return
    }
    void loadChats()
  }

  async function handleSend(promptOverride?: string) {
    const content = (promptOverride ?? input).trim()
    if (!content || streaming) return
    if (Boolean(workflow?.matterScoped) && context.type === 'general') {
      setContextPickerOpen(true)
      return
    }
    setInput('')
    const attachedWorkflow = workflow
    setWorkflow(null)

    if (chatId) {
      await streamInto(chatId, content, attachedWorkflow)
      return
    }

    // First message: create the chat, hand the message to the chat page.
    const response = await fetch('/api/admin/assistant/chats', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(context.type === 'general'
        ? { context_type: 'general' }
        : { context_type: context.type, context_id: context.id }),
    })
    const body = await response.json().catch(() => ({})) as { chat?: { id: string }; error?: string }
    if (!response.ok || !body.chat) {
      toast.error(body.error ?? 'Unable to start a chat')
      setInput(content)
      setWorkflow(attachedWorkflow)
      return
    }
    const pending: PendingMessage = { chatId: body.chat.id, content, workflow: attachedWorkflow }
    sessionStorage.setItem(PENDING_MESSAGE_KEY, JSON.stringify(pending))
    router.push(`/admin/assistant/chat/${body.chat.id}`)
  }

  const emptyState = !chatId && messages.length === 0
  // A matter-scoped workflow cannot run in a general chat; the server refuses
  // it. Hold the send here and open the picker so the fix is one click.
  const needsMatter = Boolean(workflow?.matterScoped) && context.type === 'general'
  const sendBlocked = needsMatter
    ? {
        reason: `“${workflow?.title}” works from a matter. Pick the matter or lead this is about and the assistant reads its record.`,
        actionLabel: 'Pick a matter',
        onAction: () => setContextPickerOpen(true),
      }
    : null
  const contextPicker = (
    <AssistantContextPicker
      context={context}
      onChange={next => void handleContextChange(next)}
      disabled={streaming}
      open={contextPickerOpen}
      onOpenChange={setContextPickerOpen}
    />
  )

  return (
    <AdminPageShell className="gap-4 overflow-hidden">
      <PageHeader
        eyebrow="AI assistant"
        icon={Sparkles}
        title="Assistant"
        description="Chats are saved per attorney. Point a chat at a matter to work from its record; attach a workflow to run an attorney-approved playbook."
        actions={contextPicker}
      />
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="hidden md:flex">
          <ChatHistorySidebar chats={chats} activeChatId={chatId ?? null} onChanged={loadChats} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {emptyState ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6">
              <div className="text-center">
                <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/60" />
                <h2 className="mt-3 text-lg font-semibold">What are we working on?</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Drafting prep, client follow-ups, matter questions, Massachusetts estate planning.
                </p>
              </div>
              <div className="w-full max-w-2xl">
                <AssistantComposer
                  value={input}
                  onChange={setInput}
                  onSend={() => void handleSend()}
                  onStop={stop}
                  streaming={streaming}
                  workflow={workflow}
                  onWorkflowChange={handleWorkflowChange}
                  sendBlocked={sendBlocked}
                  autoFocus
                />
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {SUGGESTED_PROMPTS.map(prompt => (
                    <Button
                      key={prompt}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto whitespace-normal py-1.5 text-xs"
                      onClick={() => void handleSend(prompt)}
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              {loadingChat ? (
                <p className="flex-1 p-6 text-sm text-muted-foreground">Loading conversation…</p>
              ) : (
                <AssistantThread messages={messages} streaming={streaming} />
              )}
              <AssistantComposer
                value={input}
                onChange={setInput}
                onSend={() => void handleSend()}
                onStop={stop}
                streaming={streaming}
                workflow={workflow}
                onWorkflowChange={handleWorkflowChange}
                sendBlocked={sendBlocked}
              />
            </>
          )}
        </div>
      </div>
    </AdminPageShell>
  )
}
