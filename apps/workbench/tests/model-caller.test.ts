import { describe, expect, it } from 'vitest'
import { createModelCaller, isRetryable } from '@/lib/anthropic'
import type { ModelRequest, ModelResponse } from '@aubrey-law/citations/review/model'

const request = { model: 'claude-sonnet-5', max_tokens: 16, messages: [] } as unknown as ModelRequest
const response = { usage: { input_tokens: 10, output_tokens: 5 } } as unknown as ModelResponse
const context = { route: 'review/playbook' }

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status })

describe('isRetryable', () => {
  it.each([408, 429, 500, 503])('retries HTTP %s', (status) => {
    expect(isRetryable(httpError(status))).toBe(true)
  })

  it.each([400, 401, 403, 404, 422])('does not retry HTTP %s', (status) => {
    // A bad request retried three times is the same bad request three times,
    // and it hides a real bug behind a slow failure.
    expect(isRetryable(httpError(status))).toBe(false)
  })

  it('retries an error with no status, which is a transport failure', () => {
    expect(isRetryable(new Error('fetch failed'))).toBe(true)
  })
})

describe('createModelCaller', () => {
  it('returns the response and records what it cost', async () => {
    const logged: unknown[] = []
    const call = createModelCaller({
      createMessage: async () => response,
      logUsage: async (row) => void logged.push(row),
      sleep: async () => {},
    })
    expect(await call(request, context)).toBe(response)
    expect(logged).toEqual([
      expect.objectContaining({
        route: 'review/playbook',
        model: 'claude-sonnet-5',
        inputTokens: 10,
        outputTokens: 5,
        success: true,
      }),
    ])
  })

  it('retries a transient failure and succeeds', async () => {
    let attempts = 0
    const call = createModelCaller({
      createMessage: async () => {
        attempts += 1
        if (attempts < 3) throw httpError(529)
        return response
      },
      logUsage: async () => {},
      sleep: async () => {},
    })
    expect(await call(request, context)).toBe(response)
    expect(attempts).toBe(3)
  })

  it('gives up on a rejection that retrying cannot fix', async () => {
    let attempts = 0
    const call = createModelCaller({
      createMessage: async () => {
        attempts += 1
        throw httpError(400)
      },
      logUsage: async () => {},
      sleep: async () => {},
    })
    await expect(call(request, context)).rejects.toThrow(/400/)
    expect(attempts).toBe(1)
  })

  it('records the failure before throwing, so a failed run still costs something visible', async () => {
    const logged: Array<{ success?: boolean; errorMessage?: string | null }> = []
    const call = createModelCaller({
      createMessage: async () => {
        throw httpError(400)
      },
      logUsage: async (row) => void logged.push(row),
      sleep: async () => {},
    })
    await expect(call(request, context)).rejects.toThrow()
    expect(logged).toHaveLength(1)
    expect(logged[0].success).toBe(false)
    expect(logged[0].errorMessage).toMatch(/400/)
  })

  it('never lets a logging failure break the call', async () => {
    const call = createModelCaller({
      createMessage: async () => response,
      logUsage: async () => {
        throw new Error('ai_usage insert failed')
      },
      sleep: async () => {},
    })
    // Accounting is not worth losing a review over.
    expect(await call(request, context)).toBe(response)
  })

  it('backs off further on each attempt', async () => {
    const waits: number[] = []
    let attempts = 0
    const call = createModelCaller({
      createMessage: async () => {
        attempts += 1
        if (attempts < 3) throw httpError(500)
        return response
      },
      logUsage: async () => {},
      sleep: async (ms) => void waits.push(ms),
    })
    await call(request, context)
    expect(waits).toHaveLength(2)
    expect(waits[1]).toBeGreaterThan(waits[0])
  })
})
