import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
  logAiUsage: vi.fn(),
}))
vi.mock('@/lib/anthropic', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/anthropic')>()),
  getAnthropicClient: vi.fn(async () => ({ messages: { stream: mocks.stream } })),
}))
vi.mock('@/lib/aiUsage', () => ({ logAiUsage: mocks.logAiUsage }))
vi.mock('@/lib/firmModels', () => ({ resolveFirmModel: vi.fn(async () => 'claude-test') }))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn() }))

import { createAdminChatStream, type AdminChatToolExecutor } from '@/lib/adminChat/engine'

type FinalMessage = {
  model?: string
  stop_reason: string
  content: Array<Record<string, unknown>>
  usage?: Record<string, number>
}

/** Stands in for the SDK's MessageStream: async-iterable, abortable, final message. */
function fakeStream(deltas: string[], final: FinalMessage) {
  let aborted = false
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const text of deltas) {
        if (aborted) return
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text } }
      }
    },
    finalMessage: async () => final,
    abort: () => { aborted = true },
    get aborted() { return aborted },
  }
}

const usage = { route: 'admin/assistant', contextType: 'general' as const, matterId: null, userId: 'user-1' }

async function readAll(response: Response): Promise<string> {
  return await new Response(response.body).text()
}

beforeEach(() => vi.clearAllMocks())

describe('the chat stream persists what it produced', () => {
  it('streams text and hands the whole reply to onComplete', async () => {
    mocks.stream.mockReturnValue(fakeStream(['Hello ', 'world'], { stop_reason: 'end_turn', content: [] }))
    const completed: Array<{ text: string; success: boolean }> = []

    const body = await readAll(createAdminChatStream({
      system: 's', messages: [{ role: 'user', content: 'hi' }], usage,
      onComplete: async result => { completed.push(result) },
    }))

    expect(body).toContain('"text":"Hello "')
    expect(body).toContain('data: [DONE]')
    expect(completed).toEqual([expect.objectContaining({ text: 'Hello world', success: true })])
  })

  it('reports a failure to the client and persists the partial reply', async () => {
    mocks.stream.mockImplementation(() => { throw new Error('upstream exploded') })
    const completed: Array<{ success: boolean; errorMessage?: string }> = []

    const body = await readAll(createAdminChatStream({
      system: 's', messages: [{ role: 'user', content: 'hi' }], usage,
      onComplete: async result => { completed.push(result) },
    }))

    expect(body).toContain('Chat unavailable')
    expect(completed[0]).toMatchObject({ success: false, errorMessage: 'upstream exploded' })
  })
})

describe('the tool loop does not truncate in silence', () => {
  const alwaysToolUse: FinalMessage = {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 'tu-1', name: 'noop', input: {} }],
  }
  const noop: AdminChatToolExecutor = {
    tool: { name: 'noop', description: 'does nothing', input_schema: { type: 'object', properties: {} } },
    execute: async () => ({ content: '{"ok":true}' }),
  }

  it('says so when it hits the iteration cap', async () => {
    mocks.stream.mockReturnValue(fakeStream(['working'], alwaysToolUse))

    const body = await readAll(createAdminChatStream({
      system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [noop], maxIterations: 2, usage,
    }))

    expect(mocks.stream).toHaveBeenCalledTimes(2)
    expect(body).toContain('tool loop limit')
  })

  it('tells the model when it asks for a tool that is not registered', async () => {
    mocks.stream
      .mockReturnValueOnce(fakeStream([], {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu-1', name: 'ghost', input: {} }],
      }))
      .mockReturnValueOnce(fakeStream(['done'], { stop_reason: 'end_turn', content: [] }))

    const body = await readAll(createAdminChatStream({
      system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [noop], maxIterations: 3, usage,
    }))

    expect(body).toContain('"text":"done"')
  })
})

describe('a client that hangs up stops the work', () => {
  it('aborts the model stream and persists what was already shown', async () => {
    const slow = {
      aborted: false,
      [Symbol.asyncIterator]: async function* (this: { aborted: boolean }) {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } }
        // Stay open until the consumer goes away.
        for (let i = 0; i < 50; i++) {
          if (this.aborted) return
          await new Promise(resolve => setTimeout(resolve, 5))
        }
      },
      finalMessage: async () => ({ stop_reason: 'end_turn', content: [] }),
      abort() { this.aborted = true },
    }
    mocks.stream.mockReturnValue(slow)
    const completed: Array<{ text: string; aborted?: boolean }> = []

    const response = createAdminChatStream({
      system: 's', messages: [{ role: 'user', content: 'hi' }], usage,
      onComplete: async result => { completed.push(result) },
    })
    const reader = response.body!.getReader()
    await reader.read()
    await reader.cancel()
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(slow.aborted).toBe(true)
    expect(completed[0]).toMatchObject({ text: 'partial', aborted: true })
  })
})

describe('a transient upstream failure is retried while nothing has been shown', () => {
  it('retries when the failure lands before any text reached the client', async () => {
    const overloaded = Object.assign(new Error('overloaded'), { status: 529 })
    mocks.stream
      .mockImplementationOnce(() => { throw overloaded })
      .mockReturnValueOnce(fakeStream(['recovered'], { stop_reason: 'end_turn', content: [] }))

    const body = await readAll(createAdminChatStream({
      system: 's', messages: [{ role: 'user', content: 'hi' }], usage, retryDelayMs: 1,
    }))

    expect(mocks.stream).toHaveBeenCalledTimes(2)
    expect(body).toContain('"text":"recovered"')
  })

  it('does not retry once the attorney has already seen part of the answer', async () => {
    const half = {
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'half ' } }
        throw Object.assign(new Error('dropped'), { status: 503 })
      },
      finalMessage: async () => ({ stop_reason: 'end_turn', content: [] }),
      abort: () => {},
    }
    mocks.stream.mockReturnValue(half)

    const body = await readAll(createAdminChatStream({
      system: 's', messages: [{ role: 'user', content: 'hi' }], usage, retryDelayMs: 1,
    }))

    expect(mocks.stream).toHaveBeenCalledTimes(1)
    expect(body).toContain('Chat unavailable')
  })

  it('does not retry a request the model refused outright', async () => {
    mocks.stream.mockImplementation(() => { throw Object.assign(new Error('bad request'), { status: 400 }) })

    await readAll(createAdminChatStream({
      system: 's', messages: [{ role: 'user', content: 'hi' }], usage, retryDelayMs: 1,
    }))

    expect(mocks.stream).toHaveBeenCalledTimes(1)
  })
})
