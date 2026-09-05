import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildPdfTextLayer } from '@/lib/textLayer/pdf'
import { exportableFindings, REVIEW_TOOL_NAME, runReviewPlaybook } from '@/lib/reviewSlice/runReview'
import { reviewPlaybookSchema, type ReviewPlaybook } from '@/lib/reviewSlice/types'
import type { AnthropicMessageResponse } from '@/lib/anthropic'
import type { TextLayer } from '@/lib/textLayer/types'

/**
 * Used to be read from `tools/workflows/review/ma-trust-firm-qa.json`. That
 * file is gone — the playbook lives in the database now (see
 * `apps/workbench/lib/review/playbook.ts` and the seed migration
 * `supabase/migrations/20261028010000_seed_review_playbook.sql`), read there
 * through a Supabase client this standalone script deliberately has no
 * dependency on. Inlined here rather than reintroducing that dependency,
 * kept byte-for-byte identical to what the seed migration inserts (see
 * `apps/workbench/tests/review-playbook.test.ts`, which checks the migration
 * against its own stated hash) so this file's assertions — about *this*
 * playbook's rules and severities — keep meaning what they said.
 */
const PLAYBOOK: ReviewPlaybook = reviewPlaybookSchema.parse({
  slug: 'ma-trust-firm-qa',
  title: 'Massachusetts revocable trust — firm quality review',
  version: 1,
  rules: [
    {
      number: '1',
      risk: 'high',
      statement:
        "Our exculpation and indemnity language carves out gross negligence and bad faith, not willful misconduct alone. A carve-out limited to willful misconduct leaves our beneficiaries without recourse for conduct well short of intentional wrongdoing, and is narrower than we intend to draft.",
      preferredLanguage:
        "except to the extent such claims arise from the Trustee's own willful misconduct, bad faith, or gross negligence",
    },
    {
      number: '2',
      risk: 'medium',
      statement:
        "Our waiver of the trustee's bond is limited to trustees named in the instrument and successors appointed under its terms. An unqualified waiver running to anyone who ever serves removes the protection at exactly the point it is needed — when a trustee nobody chose takes office.",
    },
    {
      number: '3',
      risk: 'blocker',
      statement:
        "Every discretionary distribution standard we draft states whether the trustee considers a beneficiary's other resources. Silence is the defect: it leaves our trustee to guess, and it changes both the tax treatment and the creditor exposure of the interest.",
    },
  ],
})

let cached: TextLayer | null = null
async function trustLayer(): Promise<TextLayer> {
  cached ??= await buildPdfTextLayer(
    fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/text-layer/trust-excerpt.pdf')),
  )
  return cached
}

function toolResponse(input: Record<string, unknown>): AnthropicMessageResponse {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'test',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
    content: [{ type: 'tool_use', id: 'tu_1', name: REVIEW_TOOL_NAME, input }],
  } as unknown as AnthropicMessageResponse
}

/** Answers each rule in playbook order from a queue of canned tool inputs. */
function scriptedModel(inputs: Array<Record<string, unknown>>) {
  const queue = [...inputs]
  return vi.fn(async () => toolResponse(queue.shift() ?? { outcome: 'compliant', rationale: '', quote: null, block_index: null, proposed_language: null }))
}

describe('review playbook run', () => {
  it('verifies a quoted deviation into a citation', async () => {
    const layer = await trustLayer()
    const indemnity = layer.blocks.find(b => b.text.startsWith('The Settlor shall indemnify'))!

    const result = await runReviewPlaybook(layer, PLAYBOOK, {
      callModel: scriptedModel([
        {
          outcome: 'deviation',
          rationale: 'The carve-out reaches willful misconduct only.',
          quote: 'except for claims arising from the Trustee willful misconduct',
          block_index: indemnity.index,
          proposed_language: "except to the extent such claims arise from the Trustee's own willful misconduct, bad faith, or gross negligence",
        },
      ]),
    })

    const finding = result.findings[0]
    expect(finding.outcome).toBe('deviation')
    expect(finding.severity).toBe('high')
    expect(finding.citation).not.toBeNull()
    expect(finding.citation?.verification).toBe('verified')
    expect(layer.text.slice(finding.citation!.charStart, finding.citation!.charEnd)).toBe(
      finding.citation!.quote,
    )
    expect(finding.citationRefusal).toBeNull()
  })

  /**
   * The case the whole design exists for. A confident finding whose quote is
   * not in the document keeps its rationale for a human to weigh, carries no
   * citation, and cannot be exported.
   */
  it('strips the citation from a finding whose quote is not in the document', async () => {
    const layer = await trustLayer()
    const result = await runReviewPlaybook(layer, PLAYBOOK, {
      callModel: scriptedModel([
        {
          outcome: 'deviation',
          rationale: 'The trustee is required to post a bond in every jurisdiction.',
          quote: 'the Trustee shall post a surety bond in every jurisdiction',
          block_index: 3,
          proposed_language: 'No bond shall be required',
        },
      ]),
    })

    const finding = result.findings[0]
    expect(finding.outcome).toBe('deviation')
    expect(finding.rationale).toContain('bond')
    expect(finding.citation).toBeNull()
    expect(finding.citationRefusal).toBe('not_found')
    expect(exportableFindings(result)).toHaveLength(0)
  })

  it('refuses a quote the document repeats, rather than guessing which one', async () => {
    const layer = await trustLayer()
    const result = await runReviewPlaybook(layer, PLAYBOOK, {
      callModel: scriptedModel([
        {
          outcome: 'deviation',
          rationale: 'Discretion is unguided.',
          quote: 'the Trustee shall',
          block_index: null,
          proposed_language: 'the Trustee shall, without regard to other resources,',
        },
      ]),
    })
    expect(result.findings[0].citation).toBeNull()
    expect(result.findings[0].citationRefusal).toBe('ambiguous')
  })

  /**
   * A rejected citation has to say what was attempted, not only that something
   * was. The rejection rate is the measure this whole slice is judged by, and
   * the response to a high one is to change the prompting or how the document
   * is presented — neither of which can be decided without seeing the words the
   * model tried to quote.
   */
  it('keeps the quote it could not verify, so the refusal can be diagnosed', async () => {
    const layer = await trustLayer()
    const result = await runReviewPlaybook(layer, PLAYBOOK, {
      callModel: scriptedModel([
        {
          outcome: 'deviation',
          rationale: 'Tidied the punctuation while quoting.',
          quote: 'the Trustee shall never be liable to any person whatsoever',
          block_index: null,
          proposed_language: null,
        },
      ]),
    })
    const [finding] = result.findings
    expect(finding.citationRefusal).toBe('not_found')
    expect(finding.attemptedQuote).toBe('the Trustee shall never be liable to any person whatsoever')
  })

  it('has no attempted quote when the citation was accepted', async () => {
    const layer = await trustLayer()
    const result = await runReviewPlaybook(layer, PLAYBOOK, {
      callModel: scriptedModel([
        {
          outcome: 'deviation',
          rationale: 'Liability is carved out only for willful misconduct.',
          quote: 'willful misconduct',
          block_index: null,
          proposed_language: 'willful misconduct, bad faith, or gross negligence',
        },
      ]),
    })
    expect(result.findings[0].attemptedQuote).toBeNull()
  })

  /**
   * Absence is the finding a review exists to catch, and it has nothing to
   * quote by definition. It must not be recorded as a citation failure.
   */
  it('records an absent point without treating the missing quote as a refusal', async () => {
    const layer = await trustLayer()
    const result = await runReviewPlaybook(layer, PLAYBOOK, {
      callModel: scriptedModel([
        {
          outcome: 'absent',
          rationale: 'The instrument does not say whether other resources are considered.',
          quote: null,
          block_index: null,
          proposed_language: null,
        },
      ]),
    })
    expect(result.findings[0].outcome).toBe('absent')
    expect(result.findings[0].severity).toBe('high')
    expect(result.findings[0].citation).toBeNull()
    expect(result.findings[0].citationRefusal).toBeNull()
  })

  it('runs every rule and survives one of them failing', async () => {
    const layer = await trustLayer()
    let call = 0
    const result = await runReviewPlaybook(layer, PLAYBOOK, {
      callModel: vi.fn(async () => {
        call += 1
        if (call === 2) throw new Error('overloaded')
        return toolResponse({
          outcome: 'compliant',
          rationale: 'Meets the position.',
          quote: null,
          block_index: null,
          proposed_language: null,
        })
      }),
    })

    expect(result.findings).toHaveLength(PLAYBOOK.rules.length - 1)
    expect(result.failures).toEqual([{ ruleNumber: '2', reason: 'overloaded' }])
  })

  it('treats a reply with no tool call as a failed rule, not a compliant one', async () => {
    const layer = await trustLayer()
    const result = await runReviewPlaybook(layer, PLAYBOOK, {
      callModel: vi.fn(async () =>
        ({
          id: 'msg', type: 'message', role: 'assistant', model: 'test',
          stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
          content: [{ type: 'text', text: 'Looks fine to me.' }],
        }) as unknown as AnthropicMessageResponse,
      ),
    })
    expect(result.findings).toHaveLength(0)
    expect(result.failures).toHaveLength(PLAYBOOK.rules.length)
  })

  it('refuses to review a document with no text layer', async () => {
    const scanned = await buildPdfTextLayer(
      fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/text-layer/scanned.pdf')),
    )
    await expect(runReviewPlaybook(scanned, PLAYBOOK, { callModel: scriptedModel([]) })).rejects.toThrow(
      /no text layer/i,
    )
  })

  it('caches the document and varies only the rule', async () => {
    const layer = await trustLayer()
    const calls: Array<Record<string, unknown>> = []
    await runReviewPlaybook(layer, PLAYBOOK, {
      callModel: vi.fn(async req => {
        calls.push(req as unknown as Record<string, unknown>)
        return toolResponse({
          outcome: 'compliant', rationale: 'ok', quote: null, block_index: null, proposed_language: null,
        })
      }),
    })

    expect(calls).toHaveLength(PLAYBOOK.rules.length)
    const systems = calls.map(c => JSON.stringify(c.system))
    // Identical prefix on every call is what makes the cache hit; if the
    // document ever varies per rule the caching silently stops working.
    expect(new Set(systems).size).toBe(1)
    expect(systems[0]).toContain('cache_control')
    expect(new Set(calls.map(c => JSON.stringify(c.messages))).size).toBe(PLAYBOOK.rules.length)
  })

  it('numbers paragraphs in the prompt with the same indexes the verifier scopes by', async () => {
    const layer = await trustLayer()
    let system = ''
    await runReviewPlaybook(layer, PLAYBOOK, {
      callModel: vi.fn(async req => {
        system = JSON.stringify((req as unknown as { system: unknown }).system)
        return toolResponse({
          outcome: 'compliant', rationale: 'ok', quote: null, block_index: null, proposed_language: null,
        })
      }),
    })
    for (const block of layer.blocks) {
      expect(system).toContain(`[¶ ${block.index}]`)
    }
    // The document reaches the model wrapped as untrusted data.
    expect(system).toContain('document_under_review')
  })

  it('only exports a deviation that is both cited and has replacement text', async () => {
    const layer = await trustLayer()
    const bond = layer.blocks.find(b => b.text.startsWith('No bond'))!
    const result = await runReviewPlaybook(layer, PLAYBOOK, {
      callModel: scriptedModel([
        // Cited, but no proposed language — nothing to write into the document.
        {
          outcome: 'deviation', rationale: 'Narrow carve-out.',
          quote: 'except for claims arising from the Trustee willful misconduct',
          block_index: 2, proposed_language: null,
        },
        // Cited and rewritable.
        {
          outcome: 'deviation', rationale: 'Waiver is unqualified.',
          quote: 'No bond or other security shall be required',
          block_index: bond.index, proposed_language: 'No bond shall be required of any Trustee named herein',
        },
        // Compliant findings are never exported however well cited.
        {
          outcome: 'compliant', rationale: 'Standard is guided.',
          quote: 'consider the beneficiary other resources known to the Trustee',
          block_index: 4, proposed_language: 'x',
        },
      ]),
    })

    const exportable = exportableFindings(result)
    expect(exportable).toHaveLength(1)
    expect(exportable[0].ruleNumber).toBe('2')
  })
})
