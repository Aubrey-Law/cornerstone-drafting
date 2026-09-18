import type { ToolEvent } from '@/app/admin/components/ChatMessage'

/**
 * One SSE reader and one tool-event mapping for the chat surfaces that speak
 * the anonymous-`data:` dialect (the assistant page and the rail).
 *
 * Each used to carry its own near-identical copy, and they had drifted: the
 * assistant page dropped task and proposal fields the rail handled, and the two
 * disagreed about the casing of result keys.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** First defined value among the given keys — result keys are not consistently cased. */
function pick<T>(result: Record<string, unknown> | undefined, keys: string[], guard: (value: unknown) => value is T): T | undefined {
  if (!result) return undefined
  for (const key of keys) {
    const value = result[key]
    if (guard(value)) return value
  }
  return undefined
}

const isString = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number'

export interface EmittedToolEvent {
  tool: string
  tool_use_id: string
  status: ToolEvent['status']
  result?: Record<string, unknown>
  error?: unknown
}

/** Map an emitted tool event to the chip a thread renders. */
export function toolEventFrom(event: EmittedToolEvent): ToolEvent {
  const result = isRecord(event.result) ? event.result : undefined
  return {
    tool: event.tool,
    toolUseId: event.tool_use_id,
    status: event.status,
    taskId: pick(result, ['task_id', 'taskId'], isString),
    taskTitle: pick(result, ['title', 'task_title', 'taskTitle'], isString),
    matterId: pick(result, ['matter_id', 'matterId'], isString),
    filename: pick(result, ['filename'], isString),
    signedUrl: pick(result, ['signed_url', 'signedUrl'], isString),
    downloadUrl: pick(result, ['download_url', 'downloadUrl'], isString),
    exportCount: pick(result, ['row_count', 'exportCount'], isNumber),
    totalClaim: pick(result, ['total_claim', 'totalClaim'], isNumber),
    preview: Array.isArray(result?.preview) ? result.preview as ToolEvent['preview'] : undefined,
    proposed: isRecord(result?.proposed) ? result.proposed as ToolEvent['proposed'] : undefined,
    proposal: Array.isArray(result?.proposal) ? result.proposal as ToolEvent['proposal'] : undefined,
    error: typeof event.error === 'string' ? event.error : undefined,
    detail: result,
  }
}

export interface SseFrame {
  text?: string
  error?: string
  tool?: string
  tool_use_id?: string
  status?: ToolEvent['status']
  result?: Record<string, unknown>
  workflow_applied?: { workflow_id?: string; title?: string }
}

/**
 * Read an SSE body frame by frame, handing each decoded `data:` payload to
 * `onFrame`. A malformed frame is skipped rather than aborting the whole read —
 * one bad frame used to surface as a generic "chat unavailable".
 */
export async function forEachSseFrame(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: SseFrame) => void,
): Promise<void> {
  const reader = body.getReader()
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
        let frame: SseFrame
        try {
          frame = JSON.parse(dataLine) as SseFrame
        } catch {
          continue
        }
        onFrame(frame)
      }
    }
  }
}
