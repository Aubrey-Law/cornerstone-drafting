import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildLayer, reviewLayer } from '@/lib/review/run'
import { loadReviewPlaybook } from '@/lib/review/playbook'
import type { ModelResponse } from '@aubrey-law/citations/review/model'

const FIXTURE = path.join(__dirname, 'fixtures/trust-excerpt.pdf')

/**
 * The pipeline against a real PDF, with only the model's judgement scripted.
 *
 * Extraction, offsets and quote verification all run for real here, which is
 * the half that has to be exactly right — a citation is worth nothing if the
 * offsets address different characters than the quote. What a model would
 * conclude about a trust is a matter for an attorney's eye, so it is supplied
 * rather than asserted.
 *
 * The check no test can stand in for is still the owner's: run the playbook
 * against a real third-party draft with a real key and see what share of
 * citations survive verification. A high rejection rate means changing the
 * prompting or how the document is presented — never loosening the verifier.
 */
describe('review of a real PDF', () => {
  it('extracts a citable text layer', async () => {
    const layer = await buildLayer(fs.readFileSync(FIXTURE), 'pdf')
    expect(layer.status).toBe('ok')
    expect(layer.sourceKind).toBe('pdf')
    expect(layer.blocks.length).toBeGreaterThan(1)
    // The invariant everything else rests on.
    for (const block of layer.blocks) {
      expect(layer.text.slice(block.charStart, block.charEnd)).toBe(block.text)
    }
  })

  it('verifies a quote the document really contains, with page geometry', async () => {
    const layer = await buildLayer(fs.readFileSync(FIXTURE), 'pdf')
    const playbook = loadReviewPlaybook()
    // A phrase copied out of the extracted text, the way a model is asked to.
    const block = layer.blocks.find((b) => b.text.includes('willful misconduct'))
    expect(block, 'fixture should contain an exculpation clause').toBeTruthy()
    const quote = block!.text.slice(
      block!.text.indexOf('willful misconduct'),
      block!.text.indexOf('willful misconduct') + 'willful misconduct'.length,
    )

    const result = await reviewLayer(layer, { ...playbook, rules: [playbook.rules[0]] }, {
      callModel: async () =>
        ({
          content: [
            {
              type: 'tool_use',
              name: 'report_finding',
              id: 'x',
              input: {
                outcome: 'deviation',
                rationale: 'Liability is carved out only for willful misconduct.',
                quote,
                block_index: block!.index,
                proposed_language: 'willful misconduct, bad faith, or gross negligence',
              },
            },
          ],
        }) as unknown as ModelResponse,
    })

    const [finding] = result.findings
    expect(finding.citation?.verification).toBe('verified')
    expect(layer.text.slice(finding.citation!.charStart, finding.citation!.charEnd)).toBe(quote)
    // A PDF citation carries real geometry, which is what lets the viewer
    // highlight from stored numbers instead of searching the rendered page.
    expect(finding.citation!.page).toBeGreaterThan(0)
    expect(finding.citation!.bbox).not.toBeNull()
  })

  it('refuses a quote the model did not take from the document', async () => {
    const layer = await buildLayer(fs.readFileSync(FIXTURE), 'pdf')
    const playbook = loadReviewPlaybook()
    const result = await reviewLayer(layer, { ...playbook, rules: [playbook.rules[0]] }, {
      callModel: async () =>
        ({
          content: [
            {
              type: 'tool_use',
              name: 'report_finding',
              id: 'x',
              input: {
                outcome: 'deviation',
                rationale: 'Tidied the punctuation while quoting.',
                quote: 'the Trustee shall never be liable to anyone',
                block_index: 1,
                proposed_language: null,
              },
            },
          ],
        }) as unknown as ModelResponse,
    })
    expect(result.findings[0].citation).toBeNull()
    expect(result.findings[0].citationRefusal).toBeTruthy()
  })
})
