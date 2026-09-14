'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { ToolEvent } from '@/app/admin/components/ChatMessage'
import { forEachSseFrame, toolEventFrom } from '@/app/admin/components/chatStream'

export { toolEventFrom }

export interface WorkflowRef {
  id: string
  title: string
}

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  toolEvents?: ToolEvent[]
  /** Workflow attached to this user message (rendered as a pill, not raw prefix). */
  workflowAttached?: WorkflowRef
  /** Workflow the model applied while producing this assistant message. */
  workflowApplied?: WorkflowRef
}

interface PersistedMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  events: Record<string, unknown>[]
  created_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function workflowRefFrom(value: unknown): WorkflowRef | undefined {
  if (!isRecord(value)) return undefined
  const id = value.workflow_id ?? value.id
  const title = value.title
  if (typeof id === 'string' && typeof title === 'string') return { id, title }
  return undefined
}

/** Rebuild UI messages from persisted rows (events jsonb → tool/workflow chips). */
export function messagesFromPersisted(rows: PersistedMessage[]): AssistantMessage[] {
  return rows.map(row => {
    const message: AssistantMessage = {
      id: row.id,
      role: row.role,
      content: row.content,
      timestamp: row.created_at,
    }
    for (const event of row.events ?? []) {
      if (!isRecord(event)) continue
      if (event.workflow_attached) {
        message.workflowAttached = workflowRefFrom(event.workflow_attached)
      }
      if (event.workflow_applied) {
        message.workflowApplied = workflowRefFrom(event.workflow_applied)
      }
      if (typeof event.tool === 'string' && typeof event.tool_use_id === 'string' && typeof event.status === 'string') {
        const toolEvent = toolEventFrom({
          tool: event.tool,
          tool_use_id: event.tool_use_id,
          status: event.status as ToolEvent['status'],
          result: isRecord(event.result) ? event.result : undefined,
          error: event.error,
        })
        const existing = message.toolEvents ?? []
        const idx = existing.findIndex(candidate => candidate.toolUseId === toolEvent.toolUseId)
        message.toolEvents = idx >= 0
          ? existing.map((candidate, i) => i === idx ? { ...candidate, ...toolEvent } : candidate)
          : [...existing, toolEvent]
      }
    }
    return message
  })
}

/** "45 seconds" / "2 minutes" — a wait an attorney can act on. */
function formatWait(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)} second${Math.ceil(seconds) === 1 ? '' : 's'}`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

interface StreamHandlers {
  onDelta: (text: string) => void
  onToolEvent: (event: ToolEvent) => void
  onWorkflowApplied: (workflow: WorkflowRef) => void
}

export function useAssistantStream() {
  const abortRef = useRef<AbortController | null>(null)
  const [streaming, setStreaming] = useState(false)

  useEffect(() => () => abortRef.current?.abort(), [])

  function stop() {
    abortRef.current?.abort()
  }

  /**
   * POST the message and consume the SSE reply. Resolves with the full reply
   * text once the stream ends (or the user aborts — partial text kept).
   */
  async function send(
    chatId: string,
    payload: { content: string; workflow?: WorkflowRef | null },
    handlers: StreamHandlers,
  ): Promise<{ text: string; aborted: boolean }> {
    const controller = new AbortController()
    abortRef.current = controller
    setStreaming(true)
    let replyText = ''

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(`/api/admin/assistant/chats/${chatId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const json = await response.json().catch(() => null) as { error?: string; retryAfter?: number } | null
        // A 429 already tells us how long to wait; showing "try again in a
        // moment" threw that away and left the attorney guessing.
        const headerWait = Number(response.headers.get('Retry-After') ?? '')
        const retryAfter = json?.retryAfter ?? (Number.isFinite(headerWait) && headerWait > 0 ? headerWait : null)
        if (response.status === 429 && retryAfter) {
          throw new Error(`Too many requests — try again in ${formatWait(retryAfter)}.`)
        }
        throw new Error(json?.error ?? 'Assistant unavailable - try again in a moment.')
      }

      await forEachSseFrame(response.body, parsed => {
        if (parsed.error && !parsed.tool) throw new Error(parsed.error)
        if (parsed.workflow_applied) {
          const workflow = workflowRefFrom(parsed.workflow_applied)
          if (workflow) handlers.onWorkflowApplied(workflow)
        }
        if (parsed.tool && parsed.tool_use_id && parsed.status) {
          handlers.onToolEvent(toolEventFrom({
            tool: parsed.tool,
            tool_use_id: parsed.tool_use_id,
            status: parsed.status,
            result: parsed.result,
            error: parsed.status === 'error' ? parsed.error : undefined,
          }))
          return
        }
        if (parsed.text) {
          replyText += parsed.text
          handlers.onDelta(parsed.text)
        }
      })

      return { text: replyText, aborted: false }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return { text: replyText, aborted: true }
      }
      throw error
    } finally {
      abortRef.current = null
      setStreaming(false)
    }
  }

  return { send, stop, streaming }
}
