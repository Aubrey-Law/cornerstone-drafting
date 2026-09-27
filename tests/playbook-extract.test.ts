import { describe, expect, it } from 'vitest'
import {
  EXTRACT_TOOL_NAME,
  candidatesFromInput,
  dedupeCandidates,
  extractCandidateRules,
  windowsFor,
} from '@aubrey-law/citations/playbookBuilder/extractRules'
import type { ModelRequest, ModelResponse } from '@aubrey-law/citations/review/model'
import type { TextLayer } from '@aubrey-law/citations/textLayer/types'

const PARAGRAPHS = [
  'ARTICLE 7 — SPENDTHRIFT',
  'No interest of any beneficiary shall be subject to voluntary or involuntary alienation, or to the claims of creditors.',
  'The Trustee shall serve without bond.',
  'Sarah Smith shall receive the residence at 12 Elm Street.',
]

function layerOf(paragraphs: string[]): TextLayer {
  let offset = 0
  const blocks = paragraphs.map((text, index) => {
    const block = { index, charStart: offset, charEnd: offset + text.length, text, page: null, bbox: null }
    offset += text.length + 2
    return block
  })
  return {
    sourceKind: 'docx',
    status: 'ok',
    extractor: 'test',
    extractorVersion: '1',
    sourceSha256: 'a'.repeat(64),
    pageCount: null,
    text: paragraphs.join('\n\n'),
    blocks,
    spans: [],
  }
}

const layer = layerOf(PARAGRAPHS)
const WHOLE = { firstBlock: 0, lastBlock: 3 }

const respondWith = (input: Record<string, unknown>): ModelResponse =>
  ({ content: [{ type: 'tool_use', name: EXTRACT_TOOL_NAME, id: 'x', input }] }) as unknown as ModelResponse

const spendthrift = {
  topic: 'Spendthrift',
  statement: 'Our spendthrift clause bars both voluntary and involuntary transfers and names creditors.',
  risk: 'high',
  // Typographic noise the verifier folds away: the stored text is still the document's.
  quote: 'No interest of any beneficiary shall be subject to voluntary or involuntary alienation, or to the claims of creditors.',
  block_index: 1,
  use_as_preferred_language: true,
}

describe('windowsFor', () => {
  it('groups paragraphs under a budget without splitting one, and skips blank ones', () => {
    const windows = windowsFor(layerOf(['aaaa', '', 'bbbb', 'cccc']).blocks, 9)
    expect(windows).toEqual([
      { firstBlock: 0, lastBlock: 2 },
      { firstBlock: 3, lastBlock: 3 },
    ])
  })
})

describe('candidatesFromInput', () => {
  it('uses the verified document text as preferred language, never the model string', () => {
    const [candidate] = candidatesFromInput(
      { rules: [{ ...spendthrift, quote: 'no interest of any beneficiary shall be subject to voluntary or involuntary alienation' }] },
      layer,
      0,
      WHOLE,
    )
    expect(candidate.citation?.verification).toBe('verified')
    // Case differs from the model's quote; the stored language is the document's slice.
    expect(candidate.preferredLanguage).toBe(
      'No interest of any beneficiary shall be subject to voluntary or involuntary alienation',
    )
  })

  it('keeps an unverified candidate, marks it, and gives it no preferred language', () => {
    const [candidate] = candidatesFromInput(
      { rules: [{ ...spendthrift, quote: 'The trust is irrevocable.', block_index: 1 }] },
      layer,
      0,
      WHOLE,
    )
    expect(candidate.citation).toBeNull()
    expect(candidate.citationRefusal).toBe('not_found')
    expect(candidate.attemptedQuote).toBe('The trust is irrevocable.')
    expect(candidate.preferredLanguage).toBeNull()
  })

  it('offers no preferred language for client-specific wording or a clause outside the window', () => {
    const candidates = candidatesFromInput(
      {
        rules: [
          { ...spendthrift, quote: 'Sarah Smith shall receive the residence', block_index: 3, use_as_preferred_language: false },
          { ...spendthrift, statement: 'Our trustees serve without bond.', quote: 'The Trustee shall serve without bond.', block_index: 2 },
        ],
      },
      layer,
      0,
      { firstBlock: 0, lastBlock: 1 },
    )
    expect(candidates.map((c) => c.preferredLanguage)).toEqual([null, null])
    expect(candidates.every((c) => c.citation !== null)).toBe(true)
  })

  it('drops items with no statement or an unknown risk', () => {
    const candidates = candidatesFromInput(
      { rules: [{ ...spendthrift, statement: '' }, { ...spendthrift, risk: 'critical' }, 'nonsense'] },
      layer,
      0,
      WHOLE,
    )
    expect(candidates).toEqual([])
  })
})

describe('dedupeCandidates', () => {
  it('keeps the first candidate for a cited span or a repeated statement', () => {
    const a = candidatesFromInput({ rules: [spendthrift] }, layer, 0, WHOLE)
    const b = candidatesFromInput({ rules: [{ ...spendthrift, statement: 'A differently worded duplicate.' }] }, layer, 1, WHOLE)
    const c = candidatesFromInput({ rules: [{ ...spendthrift, quote: 'nowhere in the text' }] }, layer, 2, WHOLE)
    expect(dedupeCandidates([...a, ...b, ...c]).map((x) => x.id)).toEqual(['w0-0'])
  })
})

describe('extractCandidateRules', () => {
  it('runs one call per window, the first alone, and reports a failed window instead of hiding it', async () => {
    const bigLayer = layerOf(PARAGRAPHS)
    const calls: string[] = []
    const result = await extractCandidateRules(bigLayer, {
      windowChars: 60,
      concurrency: 2,
      callModel: async (request: ModelRequest) => {
        const message = String(request.messages[0].content)
        calls.push(message)
        if (message.includes('¶ 2 through')) throw new Error('overloaded')
        if (message.includes('¶ 1 through')) return respondWith({ rules: [spendthrift] })
        return respondWith({ rules: [] })
      },
    })

    expect(result.windows.length).toBeGreaterThan(2)
    expect(calls).toHaveLength(result.windows.length)
    expect(calls[0]).toContain('¶ 0 through')
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].preferredLanguage).toBe(PARAGRAPHS[1])
    expect(result.failures).toEqual([{ window: { firstBlock: 2, lastBlock: 2 }, reason: 'overloaded' }])
  })

  it('refuses a scan before spending a call', async () => {
    let called = false
    await expect(
      extractCandidateRules(
        { ...layer, status: 'no_text' },
        {
          callModel: async () => {
            called = true
            return respondWith({ rules: [] })
          },
        },
      ),
    ).rejects.toThrow(/scan/)
    expect(called).toBe(false)
  })

  it('forces the tool and caches the document prefix', async () => {
    let seen: ModelRequest | null = null
    await extractCandidateRules(layer, {
      documentType: 'revocable trust',
      callModel: async (request) => {
        seen = request
        return respondWith({ rules: [] })
      },
    })
    expect(seen!.tool_choice).toEqual({ type: 'tool', name: EXTRACT_TOOL_NAME })
    const system = seen!.system as Array<{ text: string; cache_control?: unknown }>
    expect(system[1].cache_control).toEqual({ type: 'ephemeral' })
    expect(String(seen!.messages[0].content)).toContain("firm's revocable trust")
  })
})

describe('suggested conditions', () => {
  it('maps the closed vocabulary to conditions and ignores anything else', () => {
    const [candidate] = candidatesFromInput(
      { rules: [{ ...spendthrift, applies_when: ['has_minor_children', 'estate_over_ma_exemption', 'has_minor_children', 'rich'] }] },
      layer,
      0,
      WHOLE,
    )
    expect(candidate.conditions).toEqual([
      { fact: 'has_minor_children', test: 'is', value: true },
      { fact: 'estimated_estate_value', test: 'at_least', value: 2_000_000 },
    ])
  })
})
