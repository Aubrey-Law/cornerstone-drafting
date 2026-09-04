import { describe, expect, it } from 'vitest'
import { extractorFor, reviewLayer } from '@/lib/review/run'
import type { TextLayer } from '@aubrey-law/citations/textLayer/types'
import type { ModelResponse } from '@aubrey-law/citations/review/model'
import type { ReviewPlaybook } from '@aubrey-law/citations/review/types'

const PLAYBOOK: ReviewPlaybook = {
  slug: 'test',
  title: 'Test playbook',
  version: 1,
  rules: [{ number: '1', risk: 'high', statement: 'The trustee must be indemnified mutually.' }],
}

const TEXT = 'The Trustee shall not be liable except for willful misconduct.'
const layer = (over: Partial<TextLayer> = {}): TextLayer => ({
  sourceKind: 'docx',
  status: 'ok',
  extractor: 'test',
  extractorVersion: '1',
  sourceSha256: 'a'.repeat(64),
  pageCount: null,
  text: TEXT,
  blocks: [{ index: 0, charStart: 0, charEnd: TEXT.length, text: TEXT, page: null, bbox: null }],
  spans: [],
  ...over,
})

const respondWith = (input: Record<string, unknown>): ModelResponse =>
  ({
    content: [{ type: 'tool_use', name: 'report_finding', id: 'x', input }],
  }) as unknown as ModelResponse

describe('extractorFor', () => {
  it.each([
    ['draft.pdf', 'pdf'],
    ['DRAFT.PDF', 'pdf'],
    ['smith trust.docx', 'docx'],
  ])('reads %s as %s', (name, kind) => {
    expect(extractorFor(name)).toBe(kind)
  })

  it.each(['scan.jpg', 'notes.txt', 'draft.doc', 'nodotpdf', ''])('refuses %s', (name) => {
    // .doc is refused deliberately rather than attempted: it is a different
    // format entirely, and a failed parse would read as an empty document.
    expect(extractorFor(name)).toBeNull()
  })
})

describe('reviewLayer', () => {
  it('returns a verified citation when the model quotes the document exactly', async () => {
    const result = await reviewLayer(layer(), PLAYBOOK, {
      callModel: async () =>
        respondWith({
          outcome: 'deviation',
          rationale: 'Liability is limited to willful misconduct alone.',
          quote: 'except for willful misconduct',
          block_index: 0,
          proposed_language: 'except for willful misconduct, bad faith, or gross negligence',
        }),
    })
    const [finding] = result.findings
    expect(finding.citation?.verification).toBe('verified')
    expect(TEXT.slice(finding.citation!.charStart, finding.citation!.charEnd)).toBe(
      'except for willful misconduct',
    )
  })

  it('keeps the finding but refuses the citation when the quote is not in the document', async () => {
    // The rationale may still deserve attention; the citation is what cannot
    // be trusted, so that is the only part discarded.
    const result = await reviewLayer(layer(), PLAYBOOK, {
      callModel: async () =>
        respondWith({
          outcome: 'deviation',
          rationale: 'Paraphrased rather than quoted.',
          quote: 'the trustee is not liable for anything at all',
          block_index: 0,
          proposed_language: null,
        }),
    })
    const [finding] = result.findings
    expect(finding.citation).toBeNull()
    expect(finding.citationRefusal).toBeTruthy()
    expect(finding.rationale).toMatch(/Paraphrased/)
  })

  /**
   * A scan yields a valid layer with no characters. Reviewing it would produce
   * findings about nothing — every rule reading as "absent" against an empty
   * document, which is a page full of confident wrong answers.
   */
  it('refuses a document with no text layer, and says why', async () => {
    await expect(
      reviewLayer(layer({ status: 'no_text', text: '', blocks: [] }), PLAYBOOK, {
        callModel: async () => {
          throw new Error('should not call the model for a scan')
        },
      }),
    ).rejects.toThrow(/scan|no text layer/i)
  })

  it('reports a rule whose call failed without losing the rest of the review', async () => {
    const twoRules: ReviewPlaybook = {
      ...PLAYBOOK,
      rules: [PLAYBOOK.rules[0], { number: '2', risk: 'low', statement: 'Second rule.' }],
    }
    let calls = 0
    const result = await reviewLayer(layer(), twoRules, {
      callModel: async () => {
        calls += 1
        if (calls === 1) throw new Error('overloaded')
        return respondWith({
          outcome: 'compliant',
          rationale: 'Fine.',
          quote: null,
          block_index: null,
          proposed_language: null,
        })
      },
    })
    expect(result.failures).toEqual([{ ruleNumber: '1', reason: 'overloaded' }])
    expect(result.findings.map((f) => f.ruleNumber)).toEqual(['2'])
  })
})
