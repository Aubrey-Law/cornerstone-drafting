import type Anthropic from '@anthropic-ai/sdk'
import { PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '@aubrey-law/citations/prompt'
import type { ModelCaller, ModelRequest } from '@aubrey-law/citations/review/model'
import { verifyQuote, type VerifyReason } from '@aubrey-law/citations/textLayer/match'
import type { Citation, TextBlock, TextLayer } from '@aubrey-law/citations/textLayer/types'

/**
 * Two open-ended passes over the document open in Word, alongside the
 * playbook review:
 *
 * - **Issue spotting** reads the whole plan for substantive problems a
 *   playbook rule would not name in advance — a spouse called "wife" in one
 *   document and "husband" in another, a fiduciary named twice, a gift that
 *   contradicts the trust.
 * - **Proofread** reads it closely, a section at a time, for drafting slips:
 *   spelling and grammar, placeholders and drafting notes left in, defined
 *   terms used before or without definition, broken cross-references.
 *
 * Same rule as the playbook review: every quote is a claim until
 * `verifyQuote` finds it in exactly this text, and only a verified item may
 * mark up the document. An item whose quote cannot be found keeps its
 * explanation — it may still be right — but offers no markup.
 */

export type ScanKind = 'issues' | 'proofread'
export type Importance = 'important' | 'notable' | 'minor'

export const SCAN_CATEGORIES: Record<ScanKind, readonly string[]> = {
  issues: [
    'Names & relationships',
    'Fiduciary appointments',
    'Dispositions & beneficiaries',
    'Inconsistency between documents',
    'Tax & funding',
    'Execution & formalities',
    'Other',
  ],
  proofread: [
    'Internal annotations',
    'Spelling & grammar',
    'Defined terms',
    'Cross-references & numbering',
    'Punctuation & formatting',
    'Other',
  ],
}

export interface ScanItem {
  /** Stable within one run: kind, chunk and position. */
  id: string
  category: string
  importance: Importance
  title: string
  explanation: string
  replacement: string | null
  citation: Citation | null
  citationRefusal: VerifyReason | null
  attemptedQuote: string | null
}

export const SCAN_TOOL_NAME = 'report_items'

const TOOL: Anthropic.Tool = {
  name: SCAN_TOOL_NAME,
  description: 'Report every item found in the document section under review, most important first.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'One of the categories listed in the instructions.' },
            importance: {
              type: 'string',
              enum: ['important', 'notable', 'minor'],
              description:
                'important: would change the legal effect or embarrass the firm if signed. notable: should be fixed before signing. minor: polish.',
            },
            title: { type: 'string', description: 'A short heading, at most ten words, naming the problem.' },
            explanation: {
              type: 'string',
              description: 'One or two sentences: what the document says and why it is a problem.',
            },
            quote: {
              type: ['string', 'null'],
              description:
                'The exact text the item is about, copied character for character, short enough to be unique. Null only for something missing that has no place to point to.',
            },
            block_index: { type: ['integer', 'null'], description: 'The ¶ number shown beside the quoted text.' },
            replacement: {
              type: ['string', 'null'],
              description: 'Replacement text for exactly the quoted span, when the fix is a rewording. Null otherwise.',
            },
          },
          required: ['category', 'importance', 'title', 'explanation', 'quote', 'block_index', 'replacement'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
}

const COMMON_RULES = `
Rules for every item:
- Quote the document exactly: copy the characters as they appear, without
  tidying punctuation, spacing or spelling. A quote that does not appear
  verbatim is discarded and the item loses its support.
- Keep a quote short but unique — a phrase or a sentence, not a paragraph.
- Give the ¶ number shown beside the quoted text.
- A replacement replaces exactly the quoted span and nothing else.
- Report only real problems. Do not restate what the document does correctly,
  and do not report a matter of style the firm's forms use consistently.
- If there is nothing to report, return an empty list.

${PROMPT_INJECTION_GUARDRAIL}
`.trim()

const INSTRUCTIONS: Record<ScanKind, string> = {
  issues: `
You are a senior Massachusetts estate-planning attorney checking a client's
estate plan before it is signed. Read the whole document set and report
substantive issues: problems that would change what the plan does, confuse a
fiduciary, or embarrass the firm.

Look especially for:
- names, genders, pronouns and relationships that disagree between places
  (a spouse called "wife" in one document and "husband" in another);
- fiduciaries missing, left as placeholders, named twice in one chain, or
  named differently in different documents;
- gifts, beneficiaries or shares that contradict each other or the trust;
- provisions that cannot work as written, or leave a gap (no one to act, no
  one to receive);
- tax, funding or execution provisions that look wrong for Massachusetts.

Categories: ${SCAN_CATEGORIES.issues.join('; ')}.

${COMMON_RULES}
`.trim(),
  proofread: `
You are proofreading one section of an estate-planning document before it is
signed. Report drafting slips, not legal judgement.

Look especially for:
- internal annotations left in: TBD, [brackets], drafting notes, highlighted
  instructions, placeholder names;
- spelling, grammar and pronoun-case errors;
- defined terms used without definition, or capitalised inconsistently;
- cross-references to sections or articles that do not match, and numbering
  that skips or repeats;
- doubled words, spaces before punctuation, unmatched quotation marks or
  parentheses.

Categories: ${SCAN_CATEGORIES.proofread.join('; ')}.

${COMMON_RULES}
`.trim(),
}

/** Largest section sent in one call. Issue spotting wants the whole plan at once; proofreading wants it close. */
const CHUNK_CHARS: Record<ScanKind, number> = { issues: 480_000, proofread: 40_000 }
const MAX_TOKENS: Record<ScanKind, number> = { issues: 8_000, proofread: 6_000 }
const MAX_ITEMS_PER_CHUNK = 40

/** Blocks grouped into sections of at most `limit` characters; a block is never split. */
export function chunkBlocks(blocks: TextBlock[], limit: number): TextBlock[][] {
  const chunks: TextBlock[][] = []
  let current: TextBlock[] = []
  let size = 0
  for (const block of blocks) {
    if (block.text.trim().length === 0) continue
    if (current.length > 0 && size + block.text.length > limit) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(block)
    size += block.text.length
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

const IMPORTANCE = new Set<Importance>(['important', 'notable', 'minor'])

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** Turns one call's tool input into items, verifying each quote against the whole document. */
export function itemsFromAnswer(kind: ScanKind, chunkIndex: number, input: unknown, layer: TextLayer): ScanItem[] {
  const raw = (input as { items?: unknown } | null)?.items
  if (!Array.isArray(raw)) throw new Error('The answer had no list of items.')
  const categories = new Set(SCAN_CATEGORIES[kind])
  return raw.slice(0, MAX_ITEMS_PER_CHUNK).flatMap((entry, position): ScanItem[] => {
    const item = (entry ?? {}) as Record<string, unknown>
    const title = asText(item.title)
    if (!title) return []
    const importance = IMPORTANCE.has(item.importance as Importance) ? (item.importance as Importance) : 'notable'
    const category = typeof item.category === 'string' && categories.has(item.category) ? item.category : 'Other'
    const quote = asText(item.quote)
    let citation: Citation | null = null
    let citationRefusal: VerifyReason | null = null
    let attemptedQuote: string | null = null
    if (quote) {
      const verified = verifyQuote(layer, quote, typeof item.block_index === 'number' ? item.block_index : null)
      if (verified.ok) citation = verified.citation
      else {
        citationRefusal = verified.reason
        attemptedQuote = quote
      }
    }
    return [
      {
        id: `${kind}-${chunkIndex}-${position}`,
        category,
        importance,
        title,
        explanation: asText(item.explanation) ?? '',
        // A replacement is only meaningful against a passage that is really there.
        replacement: citation ? asText(item.replacement) : null,
        citation,
        citationRefusal,
        attemptedQuote,
      },
    ]
  })
}

/** One problem reported twice — by overlapping sections, or twice in one answer — is shown once. */
function dedupeKey(item: ScanItem): string {
  const where = item.citation ? `${item.citation.charStart}:${item.citation.charEnd}` : (item.attemptedQuote ?? '')
  return `${item.title.toLowerCase()}|${where}`
}

export interface RunScanOptions {
  callModel: ModelCaller
  model: string
  matterId: string | null
  userId: string | null
  concurrency?: number
  signal?: AbortSignal
  onItems: (items: ScanItem[]) => void
  onFailure: (failure: { section: number; reason: string }) => void
}

/**
 * Runs one kind of scan section by section and reports items as each section
 * settles. Fail-soft per section: one that fails is reported, never costs the
 * others, and is never counted as a section with nothing wrong.
 */
export async function runScan(
  layer: TextLayer,
  kind: ScanKind,
  options: RunScanOptions,
): Promise<{ sections: number; completed: number; aborted: boolean }> {
  const chunks = chunkBlocks(layer.blocks, CHUNK_CHARS[kind])
  const seen = new Set<string>()
  let completed = 0
  let next = 0

  const runOne = async (index: number) => {
    const blocks = chunks[index]
    const section =
      chunks.length > 1
        ? `This is section ${index + 1} of ${chunks.length} of the document.\n\n`
        : ''
    const numbered = blocks.map(block => `[¶ ${block.index}] ${block.text}`).join('\n\n')
    try {
      const response = await options.callModel(
        {
          model: options.model,
          max_tokens: MAX_TOKENS[kind],
          system: [{ type: 'text', text: INSTRUCTIONS[kind] }],
          messages: [
            {
              role: 'user',
              content: `${section}${quoteUserContent('document_under_review', numbered)}\n\nReport every item using the ${SCAN_TOOL_NAME} tool.`,
            },
          ],
          tools: [TOOL],
          tool_choice: { type: 'tool', name: SCAN_TOOL_NAME },
        } as ModelRequest,
        { route: `addin/${kind}`, matterId: options.matterId, userId: options.userId, contextType: 'matter' },
      )
      const block = response.content.find(part => part.type === 'tool_use' && part.name === SCAN_TOOL_NAME)
      if (!block || block.type !== 'tool_use') throw new Error('The answer did not use the reporting tool.')
      const items = itemsFromAnswer(kind, index, block.input, layer).filter(item => {
        const key = dedupeKey(item)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      completed += 1
      options.onItems(items)
    } catch (error) {
      options.onFailure({ section: index + 1, reason: error instanceof Error ? error.message : 'This section could not be checked.' })
    }
  }

  const worker = async () => {
    while (next < chunks.length && !options.signal?.aborted) {
      const index = next++
      await runOne(index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, chunks.length) }, worker))
  return { sections: chunks.length, completed, aborted: Boolean(options.signal?.aborted) }
}
