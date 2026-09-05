import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildLayer, reviewLayer } from '@/lib/review/run'
import { loadReviewPlaybook, REVIEW_PLAYBOOK_SLUG } from '@/lib/review/playbook'
import type { ModelResponse } from '@aubrey-law/citations/review/model'

const FIXTURE = path.join(__dirname, 'fixtures/trust-excerpt.pdf')

/**
 * The playbook now lives in the database, so what used to be a synchronous
 * module import is a query. This is a narrow, hand-built fake of the one
 * shape `loadReviewPlaybook` touches — the same idiom
 * `apps/workbench/tests/supabase-clients.test.ts` uses for `readUserRole` —
 * standing in for a real `prompts` / `prompt_publications` / `prompt_versions`
 * chain so this test can still run with no database.
 */
function fakePublishedPrompt() {
  const prompt = { id: 'p-1', slug: REVIEW_PLAYBOOK_SLUG, title: 'MA trust firm QA', kind: 'review' }
  const version = {
    id: 'v-1',
    version_number: 1,
    body: {
      kind: 'review',
      inputs: [],
      rules: [
        {
          number: '1',
          risk: 'high',
          statement: 'Our exculpation and indemnity language carves out gross negligence and bad faith, not willful misconduct alone.',
        },
      ],
    },
  }
  return {
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => {
            if (table === 'prompts' && column === 'slug' && value === prompt.slug) {
              return { data: prompt, error: null }
            }
            if (table === 'prompt_publications' && column === 'prompt_id' && value === prompt.id) {
              return { data: { version_id: version.id }, error: null }
            }
            if (table === 'prompt_versions' && column === 'id' && value === version.id) {
              return { data: version, error: null }
            }
            return { data: null, error: null }
          },
        }),
      }
      return builder
    },
  } as never
}

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
    const playbook = await loadReviewPlaybook(fakePublishedPrompt())
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
    const playbook = await loadReviewPlaybook(fakePublishedPrompt())
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
