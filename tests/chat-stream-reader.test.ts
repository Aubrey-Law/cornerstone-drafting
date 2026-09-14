import { describe, expect, it } from 'vitest'
import { forEachSseFrame, toolEventFrom, type SseFrame } from '@/app/admin/components/chatStream'

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function framesFrom(chunks: string[]): Promise<SseFrame[]> {
  const frames: SseFrame[] = []
  await forEachSseFrame(sseBody(chunks), frame => { frames.push(frame) })
  return frames
}

describe('reading the assistant SSE stream', () => {
  it('reassembles frames split across chunk boundaries', async () => {
    const frames = await framesFrom(['data: {"text":"Hel', 'lo"}\n\ndata: {"text":" world"}\n\n'])
    expect(frames.map(frame => frame.text)).toEqual(['Hello', ' world'])
  })

  it('ignores the [DONE] sentinel and blank frames', async () => {
    expect(await framesFrom(['data: [DONE]\n\n\n\n'])).toEqual([])
  })

  // An unguarded JSON.parse meant one malformed frame aborted the whole read and
  // surfaced as a generic "chat unavailable".
  it('skips a malformed frame and keeps reading', async () => {
    const frames = await framesFrom(['data: {not json}\n\ndata: {"text":"still here"}\n\n'])
    expect(frames.map(frame => frame.text)).toEqual(['still here'])
  })

  it('carries tool events through', async () => {
    const frames = await framesFrom([
      'data: {"tool":"create_task","tool_use_id":"t1","status":"done","result":{"task_id":"task-1"}}\n\n',
    ])
    expect(toolEventFrom(frames[0] as Required<SseFrame>).taskId).toBe('task-1')
  })
})

describe('mapping a tool event', () => {
  it('accepts either casing for result keys, because the emitters disagree', () => {
    expect(toolEventFrom({ tool: 'x', tool_use_id: 't', status: 'done', result: { download_url: '/a.csv' } }).downloadUrl)
      .toBe('/a.csv')
    expect(toolEventFrom({ tool: 'x', tool_use_id: 't', status: 'done', result: { totalClaim: 12 } }).totalClaim)
      .toBe(12)
    expect(toolEventFrom({ tool: 'x', tool_use_id: 't', status: 'done', result: { total_claim: 12 } }).totalClaim)
      .toBe(12)
  })

  it('keeps an error message only on an error event', () => {
    expect(toolEventFrom({ tool: 'x', tool_use_id: 't', status: 'error', error: 'boom' }).error).toBe('boom')
    expect(toolEventFrom({ tool: 'x', tool_use_id: 't', status: 'done', error: undefined }).error).toBeUndefined()
  })
})
