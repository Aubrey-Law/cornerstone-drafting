import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabaseAdmin', () => ({ getAdminClient: vi.fn(() => ({})) }))
vi.mock('@/lib/apiAuth', () => ({
  requireAdmin: vi.fn(async () => ({ err: null, userId: 'user-1', user: { id: 'user-1' } })),
}))
vi.mock('@/lib/rateLimit', () => ({
  consumeRateLimit: vi.fn(async () => ({ ok: true, count: 1, limit: 12, retryAfterSeconds: 0 })),
}))
vi.mock('@/lib/firmModels', () => ({ resolveFirmModel: vi.fn(async () => 'claude-test') }))

const model = vi.hoisted(() => ({ calls: [] as Array<{ model: string; rule: string }> }))
vi.mock('@/lib/anthropic', () => ({
  callAnthropic: vi.fn(async (request: { model: string; messages: Array<{ content: string }> }) => {
    const rule = String(request.messages[0].content)
    model.calls.push({ model: request.model, rule })
    return {
      content: [
        {
          type: 'tool_use',
          name: 'report_finding',
          id: 'x',
          input: {
            outcome: 'deviation',
            rationale: 'The waiver runs to anyone who serves.',
            quote: 'The Trustee shall serve without bond.',
            block_index: 2,
            proposed_language: 'Any Trustee named herein shall serve without bond.',
          },
        },
      ],
    }
  }),
}))

const store = vi.hoisted(() => ({
  playbook: null as unknown,
  facts: null as unknown,
}))
vi.mock('@/lib/addinReview/playbooks', () => ({
  loadReviewPlaybook: vi.fn(async () => store.playbook),
  loadMatterFacts: vi.fn(async () => store.facts),
}))

import { POST } from '@/app/api/addin/review/route'
import { deriveMatterFacts } from '@aubrey-law/citations/review/conditions'
import { actionsFor, applyReviewEvent, EMPTY_REVIEW, parseReviewFrame } from '../word-addin/src/taskpane/review/model'

const PARAGRAPHS = ['REVOCABLE TRUST', '', 'The Trustee shall serve without bond.', 'The Trustee may appoint a guardian.']

const PLAYBOOK = {
  slug: 'ma-trust-firm-qa',
  title: 'Trust review',
  version: 2,
  versionId: 'v2',
  rules: [
    { number: '1', risk: 'medium', statement: 'Bond is waived only for named trustees.', preferredLanguage: 'named herein' },
    {
      number: '2',
      risk: 'high',
      statement: 'Guardians are named.',
      conditions: [{ fact: 'has_minor_children', test: 'is', value: true }],
    },
  ],
}

function request(body: unknown) {
  return new Request('http://localhost/api/addin/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function frames(res: Response) {
  const text = await res.text()
  return text.split('\n\n').filter(Boolean).map((frame) => parseReviewFrame(frame)!)
}

beforeEach(() => {
  model.calls = []
  store.playbook = PLAYBOOK
  store.facts = null
})

describe('POST /api/addin/review', () => {
  it('streams a start frame, each rule’s finding, then done — in a shape the pane reads', async () => {
    const res = await POST(request({ paragraphs: PARAGRAPHS, playbookSlug: 'ma-trust-firm-qa', matterId: null }))
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    const events = await frames(res)

    expect(events[0]).toMatchObject({ start: true, playbook: { slug: 'ma-trust-firm-qa', version: 2 }, matterContext: { state: 'none' } })
    expect(events.at(-1)).toMatchObject({ done: true, completed: 2, aborted: false })
    // No matter: the conditional rule runs too.
    expect(model.calls).toHaveLength(2)
    expect(model.calls[0].model).toBe('claude-test')

    const state = events.reduce(applyReviewEvent, EMPTY_REVIEW)
    const first = state.findings.find((f) => f.ruleNumber === '1')!
    // Verified against Word's own paragraph 2, so the pane can mark it up there.
    expect(first.citation).toMatchObject({ blockIndex: 2, quote: 'The Trustee shall serve without bond.', verification: 'verified' })
    expect(actionsFor(first, state.rules[0])).toMatchObject({ reveal: true, comment: true, replace: 'Any Trustee named herein shall serve without bond.' })
  })

  it('skips a rule the linked matter rules out, without a model call', async () => {
    store.facts = deriveMatterFacts({ children: [{ name: 'A', is_minor: false }] })
    const events = await frames(await POST(request({ paragraphs: PARAGRAPHS, playbookSlug: 'ma-trust-firm-qa', matterId: 'm1' })))
    expect(events[0]).toMatchObject({ matterContext: { state: 'applied' } })
    expect(model.calls).toHaveLength(1)
    const state = events.reduce(applyReviewEvent, EMPTY_REVIEW)
    expect(state.findings.find((f) => f.ruleNumber === '2')?.outcome).toBe('not_applicable')
  })

  it('says when a linked matter has no design sheet', async () => {
    const events = await frames(await POST(request({ paragraphs: PARAGRAPHS, playbookSlug: 'ma-trust-firm-qa', matterId: 'm1' })))
    expect(events[0]).toMatchObject({ matterContext: { state: 'no_sheet' } })
  })

  it('refuses a body that is not a list of paragraphs, and an unknown playbook', async () => {
    expect((await POST(request({ paragraphs: 'text', playbookSlug: 'x' }))).status).toBe(400)
    expect((await POST(request({ paragraphs: PARAGRAPHS }))).status).toBe(400)
    expect((await POST(request({ paragraphs: ['', ' '], playbookSlug: 'x' }))).status).toBe(422)
    store.playbook = null
    expect((await POST(request({ paragraphs: PARAGRAPHS, playbookSlug: 'nope' }))).status).toBe(404)
  })
})
