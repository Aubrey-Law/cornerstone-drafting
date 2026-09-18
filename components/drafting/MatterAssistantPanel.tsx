'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Send, Sparkles, Square, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAccessToken } from '@/lib/auth/AuthTokenProvider'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/useConfirm'
import { ChatMessage, type FloatingChatMessage, type ToolEvent } from '@/app/admin/components/ChatMessage'
import { forEachSseFrame, toolEventFrom } from '@/app/admin/components/chatStream'
import type { DesignSheetImportPreviewRow, DesignSheetImportProposal } from '@/lib/designSheetImport/shared'

const DesignSheetImportDialog = dynamic(
  () => import('@/components/design-sheet/DesignSheetImportDialog').then(m => ({ default: m.DesignSheetImportDialog })),
  { ssr: false },
)

interface MatterAssistantPanelProps {
  matterId: string
  documentIds?: string[]
  onClose?: () => void
}

interface PanelMessage extends FloatingChatMessage {
  streaming?: boolean
  error?: string
}

interface DesignSheetChatProposal {
  matterId: string
  preview: DesignSheetImportPreviewRow[]
  proposed: DesignSheetImportProposal
}

function makeMessage(role: 'user' | 'assistant', content: string, matterId: string): PanelMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: new Date().toISOString(),
    contextSnapshot: { type: 'matter', id: matterId },
  }
}

/**
 * The Review step's assistant.
 *
 * It used to speak its own SSE dialect to its own chat lane and rendered tool
 * use as a line of italic text. It now reads the shared stream and draws the
 * shared cards, so a record read, a design-sheet proposal or a task proposal
 * looks and behaves the same here as on the Assistant page and in the rail.
 * The per-matter thread it shows is the one the rail shares.
 */
export function MatterAssistantPanel({ matterId, documentIds, onClose }: MatterAssistantPanelProps) {
  const { confirm, confirmDialog } = useConfirm()
  const token = useAccessToken()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [messages, setMessages] = useState<PanelMessage[]>([])
  const [designSheetProposal, setDesignSheetProposal] = useState<DesignSheetChatProposal | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const loadHistory = useCallback(async () => {
    if (!token) return
    setLoadingHistory(true)
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/assistant`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => ({})) as { turns?: Array<{ role: string; content: string; createdAt?: string }> }
      if (!res.ok) return
      setMessages((body.turns ?? []).map((turn, index) => ({
        id: `srv-${index}`,
        role: turn.role === 'user' ? 'user' : 'assistant',
        content: turn.content,
        timestamp: turn.createdAt ?? new Date().toISOString(),
        contextSnapshot: { type: 'matter', id: matterId },
      })))
    } finally {
      setLoadingHistory(false)
    }
  }, [token, matterId])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  useEffect(() => {
    const element = scrollRef.current
    if (!element || typeof element.scrollTo !== 'function') return
    // Only follow the newest message when the reader is already at the bottom;
    // scrolling back during a stream used to be undone on the next delta.
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    if (distance > 160) return
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const clearHistory = async () => {
    if (!token || busy) return
    if (!(await confirm({
      title: 'Clear this matter’s assistant chat history?',
      body: 'The conversation is removed for everyone. Drafts and documents are not affected.',
      confirmLabel: 'Clear history',
      destructive: true,
    }))) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/matters/${matterId}/assistant`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Could not clear history')
      setMessages([])
      toast.success('Chat cleared')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not clear chat')
    } finally {
      setBusy(false)
    }
  }

  const patchAssistant = (id: string, patch: (message: PanelMessage) => PanelMessage) =>
    setMessages(prev => prev.map(message => (message.id === id ? patch(message) : message)))

  const send = async (textOverride?: string) => {
    const message = (textOverride ?? input).trim()
    if (!token || !message || busy) return
    if (textOverride === undefined) setInput('')

    const userMessage = makeMessage('user', message, matterId)
    const assistantMessage = { ...makeMessage('assistant', '', matterId), streaming: true }
    setMessages(prev => [...prev, userMessage, assistantMessage])
    setBusy(true)
    let streamedText = ''
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(`/api/admin/matters/${matterId}/assistant`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ message, documentIds: documentIds ?? [] }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? 'Assistant failed')
      }

      await forEachSseFrame(res.body, parsed => {
        if (parsed.error && !parsed.tool) throw new Error(parsed.error)
        if (parsed.tool && parsed.tool_use_id && parsed.status) {
          const toolEvent = toolEventFrom({
            tool: parsed.tool,
            tool_use_id: parsed.tool_use_id,
            status: parsed.status,
            result: parsed.result,
            error: parsed.status === 'error' ? parsed.error : undefined,
          })
          patchAssistant(assistantMessage.id, current => {
            const existing = current.toolEvents ?? []
            const index = existing.findIndex(candidate => candidate.toolUseId === toolEvent.toolUseId)
            return {
              ...current,
              toolEvents: index >= 0
                ? existing.map((candidate, i) => (i === index ? { ...candidate, ...toolEvent } : candidate))
                : [...existing, toolEvent],
            }
          })
          return
        }
        if (parsed.text) {
          streamedText += parsed.text
          patchAssistant(assistantMessage.id, current => ({ ...current, content: current.content + parsed.text }))
        }
      })

      patchAssistant(assistantMessage.id, current => ({ ...current, streaming: false }))
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        // Stopped: keep any partial text, drop an empty bubble.
        setMessages(prev => streamedText
          ? prev.map(message => (message.id === assistantMessage.id ? { ...message, streaming: false } : message))
          : prev.filter(message => message.id !== assistantMessage.id))
        return
      }
      const msg = e instanceof Error ? e.message : 'Assistant request failed'
      // Keep the attorney's message visible and mark the reply as failed so it
      // can be retried, instead of silently dropping the pair.
      patchAssistant(assistantMessage.id, current => ({ ...current, streaming: false, error: msg }))
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  const retry = (assistantId: string) => {
    const index = messages.findIndex(message => message.id === assistantId)
    const userTurn = messages[index - 1]
    if (index < 1 || !userTurn || userTurn.role !== 'user' || busy) return
    setMessages(prev => prev.filter(message => message.id !== assistantId && message.id !== userTurn.id))
    void send(userTurn.content)
  }

  function handleReviewDesignSheetImport(event: ToolEvent) {
    if (!event.matterId || !event.preview?.length || !event.proposed) {
      toast.error('No design sheet proposal is available to review.')
      return
    }
    setDesignSheetProposal({ matterId: event.matterId, preview: event.preview, proposed: event.proposed })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {confirmDialog}
      {designSheetProposal && (
        <DesignSheetImportDialog
          open={Boolean(designSheetProposal)}
          onOpenChange={nextOpen => { if (!nextOpen) setDesignSheetProposal(null) }}
          matterId={designSheetProposal.matterId}
          allowUpload={false}
          initialPreview={designSheetProposal.preview}
          initialProposed={designSheetProposal.proposed}
          onAccepted={() => {
            setDesignSheetProposal(null)
            toast.success('Design sheet updates saved.')
          }}
        />
      )}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Sparkles className="h-4 w-4" />
          Draft assistant
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              disabled={busy}
              onClick={() => void clearHistory()}
              aria-label="Clear chat history"
              title="Clear chat history"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {onClose ? (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose} aria-label="Close assistant">
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
      <div ref={scrollRef} role="log" aria-live="polite" aria-busy={busy} className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
        {loadingHistory ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading history…
          </div>
        ) : messages.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Ask about fiduciaries, distribution ages, marker cleanup, or draft consistency. The assistant has this
            matter’s intake and design sheet, and can read the attached drafts and the rest of the matter record.
          </p>
        ) : (
          messages.map(message => (
            <div key={message.id}>
              <ChatMessage message={message} onReviewDesignSheetImport={handleReviewDesignSheetImport} />
              {message.streaming && !message.content && !message.toolEvents?.length ? (
                <p role="status" className="mb-3 px-2 text-xs text-muted-foreground">Thinking…</p>
              ) : null}
              {message.error ? (
                <div className="-mt-2 mb-3 flex items-center gap-2 px-2 text-xs text-destructive">
                  <span>{message.error}</span>
                  <Button size="sm" variant="ghost" className="h-5 px-1.5 text-xs" disabled={busy} onClick={() => retry(message.id)}>
                    Retry
                  </Button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
      <div className="flex gap-2 border-t border-border p-2">
        <textarea
          className="min-h-[40px] flex-1 resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs"
          placeholder="Ask the drafting assistant…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        {busy ? (
          <Button size="icon" variant="outline" onClick={() => abortRef.current?.abort()} aria-label="Stop generating" title="Stop generating">
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="icon" disabled={!input.trim()} onClick={() => void send()} aria-label="Send">
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
