'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { ToolEvent } from '@/app/admin/components/ChatMessage'

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
        const result = isRecord(event.result) ? event.result : undefined
        const toolEvent: ToolEvent = {
          tool: event.tool,
          toolUseId: event.tool_use_id,
          status: event.status as ToolEvent['status'],
          taskId: typeof result?.task_id === 'string' ? result.task_id : undefined,
          taskTitle:
            typeof result?.title === 'string'
              ? result.title
              : typeof result?.task_title === 'string'
                ? result.task_title
                : undefined,
          matterId: typeof result?.matter_id === 'string' ? result.matter_id : undefined,
          filename: typeof result?.filename === 'string' ? result.filename : undefined,
          downloadUrl: typeof result?.download_url === 'string' ? result.download_url : undefined,
          exportCount: typeof result?.row_count === 'number' ? result.row_count : undefined,
          preview: Array.isArray(result?.preview) ? result.preview as ToolEvent['preview'] : undefined,
          proposed: isRecord(result?.proposed) ? result.proposed as ToolEvent['proposed'] : undefined,
          error: typeof event.error === 'string' ? event.error : undefined,
        }
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
        const json = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(json?.error ?? 'Assistant unavailable - try again in a moment.')
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
              status?: ToolEvent['status']
              result?: Record<string, unknown>
              workflow_applied?: { workflow_id?: string; title?: string }
            }
            if (parsed.error && !parsed.tool) throw new Error(parsed.error)
            if (parsed.workflow_applied) {
              const workflow = workflowRefFrom(parsed.workflow_applied)
              if (workflow) handlers.onWorkflowApplied(workflow)
            }
            if (parsed.tool && parsed.tool_use_id && parsed.status) {
              handlers.onToolEvent({
                tool: parsed.tool,
                toolUseId: parsed.tool_use_id,
                status: parsed.status,
                matterId: typeof parsed.result?.matter_id === 'string' ? parsed.result.matter_id : undefined,
                filename: typeof parsed.result?.filename === 'string' ? parsed.result.filename : undefined,
                downloadUrl: typeof parsed.result?.download_url === 'string' ? parsed.result.download_url : undefined,
                exportCount: typeof parsed.result?.row_count === 'number' ? parsed.result.row_count : undefined,
                preview: Array.isArray(parsed.result?.preview) ? parsed.result.preview as ToolEvent['preview'] : undefined,
                proposed: isRecord(parsed.result?.proposed) ? parsed.result.proposed as ToolEvent['proposed'] : undefined,
                error: parsed.status === 'error' ? parsed.error : undefined,
              })
              continue
            }
            if (parsed.text) {
              replyText += parsed.text
              handlers.onDelta(parsed.text)
            }
          }
        }
      }
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
