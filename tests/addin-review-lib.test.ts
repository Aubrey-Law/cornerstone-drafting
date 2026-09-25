import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { buildPlainTextLayer } from '@aubrey-law/citations/textLayer/plain'
import { runRulesStreaming } from '@/lib/addinReview/runRules'
import { loadReviewPlaybook, listReviewPlaybooks } from '@/lib/addinReview/playbooks'
import type { ModelResponse } from '@aubrey-law/citations/review/model'

describe('buildPlainTextLayer', () => {
  it('keeps empty paragraphs so a block index is the Word paragraph index', () => {
    const layer = buildPlainTextLayer(['Title', '', 'Body text.'])
    expect(layer.blocks.map((b) => [b.index, b.text])).toEqual([[0, 'Title'], [1, ''], [2, 'Body text.']])
    expect(layer.text.slice(layer.blocks[2].charStart, layer.blocks[2].charEnd)).toBe('Body text.')
    expect(buildPlainTextLayer(['', '  ']).status).toBe('no_text')
  })
})

describe('runRulesStreaming', () => {
  it('runs the first rule alone, then the rest concurrently, and reports failures by rule', async () => {
    const layer = buildPlainTextLayer(['The Trustee shall serve without bond.'])
    const order: string[] = []
    let inFlight = 0
    let maxInFlight = 0
    const findings: string[] = []
    const failures: string[] = []
    const rules = ['1', '2', '3', '4', '5'].map((number) => ({ number, risk: 'low' as const, statement: `Rule ${number}` }))

    await runRulesStreaming(layer, { slug: 's', title: 'T', version: 1, rules }, {
      concurrency: 3,
      matterFacts: null,
      matterId: null,
      userId: null,
      onFinding: (f) => findings.push(f.ruleNumber),
      onFailure: (f) => failures.push(f.ruleNumber),
      callModel: async (request) => {
        const rule = String(request.messages[0].content).match(/Rule (\d)/)![1]
        order.push(rule)
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        if (rule === '1') expect(inFlight).toBe(1)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
        if (rule === '4') throw Object.assign(new Error('bad request'), { status: 400 })
        return {
          content: [
            { type: 'tool_use', name: 'report_finding', id: 'x', input: { outcome: 'compliant', rationale: 'ok', quote: null, block_index: null, proposed_language: null } },
          ],
        } as unknown as ModelResponse
      },
    })

    expect(order[0]).toBe('1')
    expect(maxInFlight).toBe(3)
    expect(findings.sort()).toEqual(['1', '2', '3', '5'])
    expect(failures).toEqual(['4'])
  })

  it('stops starting rules once aborted', async () => {
    const controller = new AbortController()
    const layer = buildPlainTextLayer(['x'])
    let calls = 0
    const result = await runRulesStreaming(
      layer,
      { slug: 's', title: 'T', version: 1, rules: ['1', '2', '3'].map((n) => ({ number: n, risk: 'low' as const, statement: n })) },
      {
        concurrency: 1,
        matterFacts: null,
        matterId: null,
        userId: null,
        signal: controller.signal,
        onFinding: () => controller.abort(),
        onFailure: () => controller.abort(),
        callModel: async () => {
          calls += 1
          return { content: [{ type: 'tool_use', name: 'report_finding', id: 'x', input: { outcome: 'compliant', rationale: '', quote: null, block_index: null, proposed_language: null } }] } as unknown as ModelResponse
        },
      },
    )
    expect(calls).toBe(1)
    expect(result.aborted).toBe(true)
  })
})

function fakeClient(tables: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const rows = () => (tables[table] ?? []).filter((row) => filters.every(([k, v]) => row[k] === v))
      const builder = {
        select: () => builder,
        eq: (k: string, v: unknown) => {
          filters.push([k, v])
          return builder
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (resolve: (value: { data: unknown; error: null }) => void) => resolve({ data: rows(), error: null }),
      }
      return builder
    },
  } as never
}

describe('the playbook loader', () => {
  const tables = {
    prompts: [
      { id: 'p1', slug: 'trust', title: 'Trust review', kind: 'review' },
      { id: 'p2', slug: 'broken', title: 'Broken', kind: 'review' },
      { id: 'p3', slug: 'audit', title: 'Audit', kind: 'field_audit' },
    ],
    prompt_publications: [
      { prompt_id: 'p1', version_id: 'v1' },
      { prompt_id: 'p2', version_id: 'v2' },
    ],
    prompt_versions: [
      { id: 'v1', version_number: 3, body: { kind: 'review', inputs: [], rules: [{ number: '1', risk: 'high', statement: 'x' }] } },
      { id: 'v2', version_number: 1, body: { kind: 'review', inputs: [], rules: [] } },
    ],
  }

  it('loads a published review playbook and refuses a body that does not validate', async () => {
    const client = fakeClient(tables)
    expect(await loadReviewPlaybook(client, 'trust')).toMatchObject({ version: 3, rules: [{ number: '1' }] })
    await expect(loadReviewPlaybook(client, 'broken')).rejects.toThrow(/valid review body/)
    expect(await loadReviewPlaybook(client, 'audit')).toBeNull()
    expect(await loadReviewPlaybook(client, 'missing')).toBeNull()
  })

  it('lists only playbooks that load, leaving a broken one out rather than failing the list', async () => {
    expect(await listReviewPlaybooks(fakeClient(tables))).toEqual([{ slug: 'trust', title: 'Trust review', version: 3, ruleCount: 1 }])
  })
})
