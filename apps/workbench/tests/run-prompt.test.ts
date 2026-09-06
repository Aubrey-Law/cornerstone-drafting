import { describe, expect, it } from 'vitest'
import { runPrompt } from '@aubrey-law/citations/prompt/runPrompt'
import type { ModelRequest, ModelResponse } from '@aubrey-law/citations/review/model'

const TOOL_NAME = 'report_thing'

function respondWith(input: Record<string, unknown>): ModelResponse {
  return { content: [{ type: 'tool_use', name: TOOL_NAME, id: 'x', input }] } as unknown as ModelResponse
}

function respondWithNoToolCall(): ModelResponse {
  return { content: [{ type: 'text', text: 'no tool used' }] } as unknown as ModelResponse
}

const requestFor = (unit: string): ModelRequest =>
  ({
    model: 'test-model',
    max_tokens: 10,
    system: [{ type: 'text', text: 'system' }],
    messages: [{ role: 'user', content: unit }],
  }) as ModelRequest

describe('runPrompt', () => {
  it('makes one call per unit', async () => {
    const calls: string[] = []
    const result = await runPrompt<string, { value: string }>(
      {
        units: ['a', 'b', 'c'],
        toolName: TOOL_NAME,
        requestFor,
        findingFor: (unit, input) => ({ value: `${unit}:${input.value}` }),
      },
      {
        callModel: async request => {
          const unit = String(request.messages[0].content)
          calls.push(unit)
          return respondWith({ value: unit.toUpperCase() })
        },
        context: { route: 'test', contextType: 'general' },
      },
    )
    expect(calls).toEqual(['a', 'b', 'c'])
    expect(result.findings).toEqual([{ value: 'a:A' }, { value: 'b:B' }, { value: 'c:C' }])
    expect(result.failures).toEqual([])
  })

  it('loses only the unit whose call throws', async () => {
    let attempts = 0
    const result = await runPrompt<string, { value: string }>(
      {
        units: ['a', 'b'],
        toolName: TOOL_NAME,
        idFor: unit => unit,
        requestFor,
        findingFor: (unit, input) => ({ value: `${unit}:${input.value}` }),
      },
      {
        callModel: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('boom')
          return respondWith({ value: 'ok' })
        },
        context: { route: 'test', contextType: 'general' },
      },
    )
    expect(result.failures).toEqual([{ unitId: 'a', reason: 'boom' }])
    expect(result.findings).toEqual([{ value: 'b:ok' }])
  })

  it('records a unit with no tool call as a failure', async () => {
    const result = await runPrompt<string, { value: string }>(
      {
        units: ['a'],
        toolName: TOOL_NAME,
        idFor: unit => unit,
        requestFor,
        findingFor: (unit, input) => ({ value: `${unit}:${input.value}` }),
      },
      {
        callModel: async () => respondWithNoToolCall(),
        context: { route: 'test', contextType: 'general' },
      },
    )
    expect(result.failures).toEqual([{ unitId: 'a', reason: 'Model returned no tool call' }])
    expect(result.findings).toEqual([])
  })

  it('records a failure carrying its own message when findingFor throws, without losing other units', async () => {
    const result = await runPrompt<string, { value: string }>(
      {
        units: ['a', 'b'],
        toolName: TOOL_NAME,
        idFor: unit => unit,
        requestFor,
        findingFor: (unit, input) => {
          if (unit === 'a') throw new Error('Unrecognised outcome weird')
          return { value: `${unit}:${input.value}` }
        },
      },
      {
        callModel: async () => respondWith({ value: 'ok' }),
        context: { route: 'test', contextType: 'general' },
      },
    )
    expect(result.failures).toEqual([{ unitId: 'a', reason: 'Unrecognised outcome weird' }])
    expect(result.findings).toEqual([{ value: 'b:ok' }])
  })

  it('defaults unitId to the stringified index when idFor is omitted', async () => {
    const result = await runPrompt<string, { value: string }>(
      {
        units: ['x'],
        toolName: TOOL_NAME,
        requestFor,
        findingFor: () => {
          throw new Error('unused')
        },
      },
      {
        callModel: async () => respondWithNoToolCall(),
        context: { route: 'test', contextType: 'general' },
      },
    )
    expect(result.failures).toEqual([{ unitId: '0', reason: 'Model returned no tool call' }])
  })

  it('reports each unit as it settles, in order, with its outcome', async () => {
    // A run that dies halfway must leave a record of how far it got. That is
    // only possible if the engine says so per unit rather than at the end.
    const settled: Array<[string, boolean]> = []
    let attempts = 0
    await runPrompt<string, { value: string }>(
      {
        units: ['a', 'b'],
        toolName: TOOL_NAME,
        idFor: unit => unit,
        requestFor,
        findingFor: (unit, input) => ({ value: `${unit}:${input.value}` }),
      },
      {
        callModel: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('overloaded')
          return respondWith({ value: 'ok' })
        },
        context: { route: 'test', contextType: 'general' },
        onUnitSettled: async (unitId, outcome) => {
          settled.push([unitId, outcome.ok])
        },
      },
    )
    expect(settled).toEqual([
      ['a', false],
      ['b', true],
    ])
  })

  it('carries the failure reason to the hook, not just to the result', async () => {
    const reasons: string[] = []
    await runPrompt<string, { value: string }>(
      {
        units: ['a'],
        toolName: TOOL_NAME,
        idFor: unit => unit,
        requestFor,
        findingFor: (unit, input) => ({ value: `${unit}:${input.value}` }),
      },
      {
        callModel: async () => {
          throw new Error('overloaded')
        },
        context: { route: 'test', contextType: 'general' },
        onUnitSettled: async (_unitId, outcome) => {
          if (!outcome.ok) reasons.push(outcome.reason)
        },
      },
    )
    expect(reasons).toEqual(['overloaded'])
  })

  it('runs without a hook, because most callers do not need one', async () => {
    const result = await runPrompt<string, { value: string }>(
      {
        units: ['a'],
        toolName: TOOL_NAME,
        idFor: unit => unit,
        requestFor,
        findingFor: (unit, input) => ({ value: `${unit}:${input.value}` }),
      },
      {
        callModel: async () => respondWith({ value: 'ok' }),
        context: { route: 'test', contextType: 'general' },
      },
    )
    expect(result.findings).toEqual([{ value: 'a:ok' }])
  })

  it('still returns findings when the recorder throws', async () => {
    const result = await runPrompt<string, { value: string }>(
      {
        units: ['a'],
        toolName: TOOL_NAME,
        idFor: unit => unit,
        requestFor,
        findingFor: (unit, input) => ({ value: `${unit}:${input.value}` }),
      },
      {
        callModel: async () => respondWith({ value: 'ok' }),
        context: { route: 'test', contextType: 'general' },
        onUnitSettled: async () => {
          throw new Error('database down')
        },
      },
    )
    expect(result.findings).toEqual([{ value: 'a:ok' }])
    expect(result.failures).toEqual([])
  })
})
