import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () =>
    auth.ok
      ? { err: null, userId: 'user-1' }
      : { err: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }), userId: null },
  ),
}))
vi.mock('@/lib/rateLimit', () => ({
  consumeRateLimit: vi.fn(async () => ({ ok: true, count: 1, limit: 20, retryAfterSeconds: 0 })),
}))
vi.mock('@/lib/firmModels', () => ({ resolveFirmModel: vi.fn(async () => 'claude-test') }))

const auth = vi.hoisted(() => ({ ok: true }))
const model = vi.hoisted(() => ({
  calls: [] as Array<{ route: string; system: string; content: string; tool: string }>,
  answer: (_content: string): unknown => ({ items: [] }),
  fail: false,
}))
vi.mock('@/lib/anthropic', () => ({
  callAnthropic: vi.fn(async (request: { system: Array<{ text: string }>; messages: Array<{ content: string }>; tool_choice: { name: string } }, context: { route: string }) => {
    const content = String(request.messages[0].content)
    model.calls.push({ route: context.route, system: request.system[0].text, content, tool: request.tool_choice.name })
    if (model.fail) throw new Error('model down')
    return { content: [{ type: 'tool_use', name: 'report_items', id: 'x', input: model.answer(content) }] }
  }),
}))

import { POST } from '@/app/api/addin/scan/route'
import { chunkBlocks, itemsFromAnswer, runScan } from '@/lib/addinScan/scan'
import { buildPlainTextLayer } from '@aubrey-law/citations/textLayer/plain'
import { applyScanEvent, EMPTY_SCAN, type ScanEvent } from '../word-addin/src/taskpane/review/scan'
import { parseReviewFrame } from '../word-addin/src/taskpane/review/model'

const PARAGRAPHS = [
  'SUMMARY OF YOUR ESTATE PLAN',
  '',
  'Avideep is named as the wife of Jugminder.',
  'The successor Trustee shall be [TBD].',
  'The Trustee ,may sell property.',
]

const row = (over: Record<string, unknown>) => ({
  category: 'Internal annotations',
  importance: 'important',
  title: 'TBD successor trustee',
  explanation: 'The successor trustee is a placeholder.',
  quote: '[TBD]',
  block_index: 3,
  replacement: 'Avideep Chawla',
  ...over,
})

function request(body: unknown) {
  return new Request('http://localhost/api/addin/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function frames(res: Response): Promise<ScanEvent[]> {
  const text = await res.text()
  return text.split('\n\n').filter(Boolean).map((frame) => parseReviewFrame(frame) as unknown as ScanEvent)
}

beforeEach(() => {
  auth.ok = true
  model.calls = []
  model.fail = false
  model.answer = () => ({ items: [] })
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

describe('itemsFromAnswer', () => {
  const layer = buildPlainTextLayer(PARAGRAPHS)

  it('verifies each quote against the document and keeps a replacement only for a verified one', () => {
    const items = itemsFromAnswer('proofread', 0, {
      items: [row({}), row({ title: 'Invented', quote: 'not in the document', replacement: 'x' })],
    }, layer)
    expect(items[0]).toMatchObject({ id: 'proofread-0-0', importance: 'important', replacement: 'Avideep Chawla' })
    expect(items[0].citation).toMatchObject({ blockIndex: 3, quote: '[TBD]', verification: 'verified' })
    expect(items[1]).toMatchObject({ citation: null, citationRefusal: 'not_found', attemptedQuote: 'not in the document', replacement: null })
  })

  it('files an unknown category under Other and an unknown importance as notable, and drops untitled rows', () => {
    const items = itemsFromAnswer('issues', 1, { items: [row({ category: 'Vibes', importance: 'urgent' }), row({ title: '' })] }, layer)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'issues-1-0', category: 'Other', importance: 'notable' })
  })

  it('refuses an answer with no list, so the section is reported as not checked', () => {
    expect(() => itemsFromAnswer('issues', 0, { nope: true }, layer)).toThrow('no list')
  })
})

describe('chunkBlocks', () => {
  it('never splits a block, and skips empty ones', () => {
    const layer = buildPlainTextLayer(['a'.repeat(30), '', 'b'.repeat(30), 'c'.repeat(30)])
    expect(chunkBlocks(layer.blocks, 65).map((chunk) => chunk.map((b) => b.index))).toEqual([[0, 2], [3]])
  })
})

describe('runScan', () => {
  it('proofreads section by section, reports a failed section by number, and shows a repeated item once', async () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ${'x'.repeat(15_000)} [TBD] marker ${i}.`)
    const layer = buildPlainTextLayer(paragraphs)
    let call = 0
    model.answer = () => {
      call += 1
      if (call === 2) return { oops: true }
      return { items: [row({ quote: 'marker 0', block_index: 0 }), row({ quote: 'marker 0', block_index: 0 })] }
    }
    const items: string[] = []
    const failures: number[] = []
    const { callAnthropic } = await import('@/lib/anthropic')
    const result = await runScan(layer, 'proofread', {
      callModel: (req, ctx) => callAnthropic(req as never, ctx as never) as never,
      model: 'claude-test',
      matterId: null,
      userId: 'user-1',
      concurrency: 1,
      onItems: (batch) => items.push(...batch.map((i) => i.id)),
      onFailure: (f) => failures.push(f.section),
    })
    expect(result.sections).toBeGreaterThan(1)
    expect(result.completed).toBe(result.sections - 1)
    expect(failures).toEqual([2])
    expect(items).toEqual(['proofread-0-0'])
    expect(model.calls[0].content).toContain(`section 1 of ${result.sections}`)
  })
})

describe('POST /api/addin/scan', () => {
  it('refuses a caller who is not staff', async () => {
    auth.ok = false
    expect((await POST(request({ kind: 'issues', paragraphs: PARAGRAPHS }))).status).toBe(403)
  })

  it('refuses an unknown kind and a document that is not a list of paragraphs', async () => {
    expect((await POST(request({ kind: 'vibes', paragraphs: PARAGRAPHS }))).status).toBe(400)
    expect((await POST(request({ kind: 'issues', paragraphs: 'text' }))).status).toBe(400)
    expect((await POST(request({ kind: 'issues', paragraphs: ['', ' '] }))).status).toBe(422)
  })

  it('says so rather than failing midway when no API key is configured', async () => {
    delete process.env.ANTHROPIC_API_KEY
    expect((await POST(request({ kind: 'issues', paragraphs: PARAGRAPHS }))).status).toBe(503)
  })

  it('streams verified items the pane can apply', async () => {
    model.answer = () => ({
      items: [
        row({ category: 'Names & relationships', title: 'Avideep called wife', quote: 'the wife of Jugminder', block_index: 2, replacement: 'the husband of Jugminder' }),
      ],
    })
    const res = await POST(request({ kind: 'issues', paragraphs: PARAGRAPHS, matterId: 'm1' }))
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    const state = (await frames(res)).reduce(applyScanEvent, EMPTY_SCAN)
    expect(state).toMatchObject({ started: true, done: true, sections: 1, failures: [] })
    expect(state.items[0]).toMatchObject({ category: 'Names & relationships', replacement: 'the husband of Jugminder' })
    expect(state.items[0].citation).toMatchObject({ blockIndex: 2, verification: 'verified' })
    expect(model.calls).toHaveLength(1)
    expect(model.calls[0]).toMatchObject({ route: 'addin/issues', tool: 'report_items' })
    expect(model.calls[0].system).toMatch(/wife/)
  })

  it('reports a section the model failed on instead of passing it as clean', async () => {
    model.fail = true
    const state = (await frames(await POST(request({ kind: 'proofread', paragraphs: PARAGRAPHS })))).reduce(applyScanEvent, EMPTY_SCAN)
    expect(state).toMatchObject({ done: true, items: [], failures: [{ section: 1, reason: 'model down' }] })
  })
})
