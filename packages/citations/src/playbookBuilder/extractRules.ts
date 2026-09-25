import type Anthropic from '@anthropic-ai/sdk'
import { PROMPT_INJECTION_GUARDRAIL, quoteUserContent } from '../prompt'
import { verifyQuote, type VerifyReason } from '../textLayer/match'
import type { Citation, TextBlock, TextLayer } from '../textLayer/types'
import type { ModelCaller, ModelRequest, ModelResponse } from '../review/model'
import type { ReviewRule } from '../review/types'
import { APPLIES_WHEN, type RuleCondition } from '../review/conditions'

/**
 * Drafting a review playbook from a precedent the firm already trusts.
 *
 * The same move a playbook tool makes when it is handed an approved will: read
 * the instrument, and state each position it takes as a rule another draft can
 * be checked against. What comes out is a *proposal*. Nothing here publishes;
 * an attorney edits, drops and re-rates every candidate before any of it can
 * become a rule, because a rule list is firm policy and a model's reading of
 * one document is not.
 *
 * Two things carry over unchanged from the review runner, and they matter more
 * here than there:
 *
 * - **Every candidate is anchored.** The model names the clause each position
 *   came from, and the quote goes through `verifyQuote` exactly as a finding's
 *   does. A candidate whose quote is not in the precedent is still returned —
 *   the position may be worth keeping — but it is marked, and it gets no
 *   preferred language.
 * - **Preferred language is the precedent's text, never the model's.** When a
 *   clause is settled wording the firm would want in every draft, the rule's
 *   `preferredLanguage` is the verified slice of the document itself. A model
 *   paraphrase presented as "our language" would be the worst possible thing
 *   for a playbook to contain.
 *
 * One call per window of paragraphs, not one call for the whole document: a
 * single pass over a forty-page trust skims, and the provisions near the end
 * get a sentence each. The full document sits in the cached system prefix so
 * every window can still read definitions and cross-references elsewhere.
 */

export type CandidateRisk = ReviewRule['risk']

export interface CandidateRule {
  /** Stable within one extraction — `w<window>-<n>` — for UI keys only. */
  id: string
  statement: string
  risk: CandidateRisk
  /** A short heading for grouping ("Trustee succession", "Spendthrift"). */
  topic: string
  /** The verified slice of the precedent, when the model chose it as the firm's wording. */
  preferredLanguage: string | null
  citation: Citation | null
  citationRefusal: Exclude<VerifyReason, 'ok'> | null
  /** What the model tried to quote, kept only when it could not be verified. */
  attemptedQuote: string | null
  /**
   * When the model judged the position to apply only to some matters. A
   * suggestion for the attorney to keep or clear, like everything else here.
   */
  conditions: RuleCondition[]
}

export interface ExtractionWindow {
  firstBlock: number
  lastBlock: number
}

export interface ExtractRulesResult {
  candidates: CandidateRule[]
  windows: ExtractionWindow[]
  /** Windows whose call failed. Named, never folded in: a skipped window is not a clean one. */
  failures: Array<{ window: ExtractionWindow; reason: string }>
}

export interface ExtractRulesDependencies {
  callModel: ModelCaller
  model?: string
  userId?: string | null
  /** Characters of paragraph text per window. */
  windowChars?: number
  /** Windows run at once after the first, which runs alone to write the cache. */
  concurrency?: number
  /** What kind of instrument this is, in the attorney's words ("revocable trust"). */
  documentType?: string | null
}

export const EXTRACT_TOOL_NAME = 'propose_rules'
const DEFAULT_WINDOW_CHARS = 12_000
const DEFAULT_CONCURRENCY = 4
const MAX_RULES_PER_WINDOW = 15

const RISKS: readonly CandidateRisk[] = ['blocker', 'high', 'medium', 'low']

const EXTRACT_TOOL: Anthropic.Tool = {
  name: EXTRACT_TOOL_NAME,
  description: 'Propose the firm positions stated in the assigned paragraphs of the precedent.',
  input_schema: {
    type: 'object',
    properties: {
      rules: {
        type: 'array',
        maxItems: MAX_RULES_PER_WINDOW,
        items: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Two to five words naming the provision ("Trustee succession").',
            },
            statement: {
              type: 'string',
              description:
                'The position as a checkable rule, in the firm’s voice: what our documents do, then one sentence on why it matters. General, never client-specific.',
            },
            risk: {
              type: 'string',
              enum: RISKS as unknown as string[],
              description:
                'blocker: a draft without it fails its purpose or is invalid. high: real exposure for the client or fiduciary. medium: a firm standard worth fixing. low: style or best practice.',
            },
            quote: {
              type: 'string',
              description:
                'The exact text of the clause that states this position, copied character for character from one paragraph.',
            },
            block_index: {
              type: 'integer',
              description: 'The ¶ number shown beside the quoted text.',
            },
            applies_when: {
              type: 'array',
              items: { type: 'string', enum: Object.keys(APPLIES_WHEN) },
              description:
                'Only when the position applies to some clients and not others: the circumstances it depends on, all of which must hold. Empty for a position every draft of this kind should take.',
            },
            use_as_preferred_language: {
              type: 'boolean',
              description:
                'True when the quoted clause is settled wording the firm would want in every draft of this kind. False when it names this client’s people, property, amounts or dates.',
            },
          },
          required: ['topic', 'statement', 'risk', 'quote', 'block_index', 'applies_when', 'use_as_preferred_language'],
          additionalProperties: false,
        },
      },
    },
    required: ['rules'],
    additionalProperties: false,
  },
}

const INSTRUCTIONS = `
You are helping an estate-planning attorney turn a precedent their firm has
approved into a review playbook: a list of firm positions that another draft of
the same kind of instrument can be checked against, one rule at a time.

You will be assigned a range of paragraphs. For each substantive position those
paragraphs take, propose one rule.

What a good rule looks like:
- One position per rule, stated so a reviewer could decide whether a different
  draft meets it. "Our spendthrift clause covers both voluntary and involuntary
  transfers and names creditors of a beneficiary expressly." Not "Include a
  spendthrift clause."
- Written in the firm's voice ("our", "we") and followed by one sentence on why
  it matters.
- General. Never name this client, their family, their property, amounts or
  dates in the statement. The rule must hold for the next client too.
- Skip what carries no position: headings, recitals of the client's facts,
  signature and notary blocks, and definitions that only fix a name.

Quoting:
- Quote the clause that states the position exactly as it appears. Copy the
  characters; do not tidy punctuation, fix spacing, or paraphrase. A quote that
  is not verbatim in the document is discarded.
- Quote from a single paragraph and give that paragraph's ¶ number.
- Quote only from your assigned paragraphs. The rest of the document is there so
  you can read definitions and cross-references, not to propose rules from.

When a position only makes sense for some clients — guardian appointments
for clients with minor children, marital-deduction planning for married
clients, estate-tax planning above the Massachusetts exemption — say so in
applies_when. Leave it empty for anything every draft of this kind should do.

Propose nothing rather than something weak. An assigned range that is all
boilerplate should return an empty list.

${PROMPT_INJECTION_GUARDRAIL}
`.trim()

/** Consecutive paragraphs up to a character budget; a paragraph is never split. */
export function windowsFor(blocks: TextBlock[], windowChars = DEFAULT_WINDOW_CHARS): ExtractionWindow[] {
  const windows: ExtractionWindow[] = []
  let start: TextBlock | null = null
  let last: TextBlock | null = null
  let size = 0

  for (const block of blocks) {
    if (!block.text.trim()) continue
    if (start && size + block.text.length > windowChars) {
      windows.push({ firstBlock: start.index, lastBlock: last!.index })
      start = null
      size = 0
    }
    if (!start) start = block
    last = block
    size += block.text.length
  }
  if (start && last) windows.push({ firstBlock: start.index, lastBlock: last.index })
  return windows
}

function documentBlock(layer: TextLayer): string {
  const numbered = layer.blocks.map(block => `[¶ ${block.index}] ${block.text}`).join('\n\n')
  return quoteUserContent('precedent_document', numbered)
}

function windowMessage(window: ExtractionWindow, documentType: string | null): string {
  const kind = documentType?.trim() ? `This precedent is the firm's ${documentType.trim()}. ` : ''
  return [
    `${kind}Your assigned paragraphs are ¶ ${window.firstBlock} through ¶ ${window.lastBlock}.`,
    `Propose the firm positions they state, using the ${EXTRACT_TOOL_NAME} tool.`,
  ].join('\n')
}

function readToolInput(response: ModelResponse): Record<string, unknown> | null {
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === EXTRACT_TOOL_NAME) {
      return block.input as Record<string, unknown>
    }
  }
  return null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * One window's tool input into candidates, each quote verified against the
 * layer. Items missing a statement or carrying an unknown risk are dropped:
 * there is nothing an attorney could approve in them.
 */
export function candidatesFromInput(
  input: Record<string, unknown>,
  layer: TextLayer,
  windowNumber: number,
  window: ExtractionWindow,
): CandidateRule[] {
  const items = Array.isArray(input.rules) ? input.rules : []
  const candidates: CandidateRule[] = []

  items.forEach((raw, n) => {
    if (typeof raw !== 'object' || raw === null) return
    const item = raw as Record<string, unknown>
    const statement = text(item.statement)
    const risk = item.risk as CandidateRisk
    if (!statement || !RISKS.includes(risk)) return

    const quote = text(item.quote)
    const blockIndex = typeof item.block_index === 'number' ? item.block_index : null

    let citation: Citation | null = null
    let citationRefusal: CandidateRule['citationRefusal'] = null
    let attemptedQuote: string | null = null

    if (!quote) {
      citationRefusal = 'empty_quote'
    } else {
      const verified = verifyQuote(layer, quote, blockIndex)
      if (verified.ok) {
        citation = verified.citation
      } else {
        citationRefusal = verified.reason
        attemptedQuote = quote
      }
    }

    // Where the verifier actually found the clause, not where the model said
    // it was: a wrong hint widens the search to the whole document.
    const outsideWindow =
      citation !== null && (citation.blockIndex < window.firstBlock || citation.blockIndex > window.lastBlock)

    candidates.push({
      id: `w${windowNumber}-${n}`,
      statement,
      risk,
      topic: text(item.topic) ?? 'General',
      // The document's slice, never the model's string — see the module note.
      // A clause cited from outside the assigned range is kept as a candidate
      // (the position is real) but is another window's to offer as wording.
      preferredLanguage:
        citation && item.use_as_preferred_language === true && !outsideWindow ? citation.quote : null,
      citation,
      citationRefusal,
      attemptedQuote,
      conditions: conditionsFrom(item.applies_when),
    })
  })

  return candidates
}

function conditionsFrom(value: unknown): RuleCondition[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap(word => {
    if (typeof word !== 'string' || !(word in APPLIES_WHEN) || seen.has(word)) return []
    seen.add(word)
    return [APPLIES_WHEN[word]]
  })
}

/**
 * Overlapping windows can both cite the same clause. The first candidate for a
 * verified span wins; unverified candidates are never merged, since there is no
 * span to compare.
 */
export function dedupeCandidates(candidates: CandidateRule[]): CandidateRule[] {
  const seenSpans = new Set<string>()
  const seenStatements = new Set<string>()
  return candidates.filter(candidate => {
    const statementKey = candidate.statement.toLowerCase().replace(/\s+/g, ' ')
    if (seenStatements.has(statementKey)) return false
    if (candidate.citation) {
      const spanKey = `${candidate.citation.charStart}:${candidate.citation.charEnd}`
      if (seenSpans.has(spanKey)) return false
      seenSpans.add(spanKey)
    }
    seenStatements.add(statementKey)
    return true
  })
}

/**
 * Proposes review rules from a precedent, with every quote checked against it.
 *
 * Fail-soft per window, like `runPrompt`: one bad response loses that window's
 * candidates and is reported in `failures`, never the extraction.
 */
export async function extractCandidateRules(
  layer: TextLayer,
  deps: ExtractRulesDependencies,
): Promise<ExtractRulesResult> {
  if (layer.status === 'no_text') {
    throw new Error(
      'This document has no text layer — it is most likely a scan. Supply the DOCX or a text PDF of the precedent instead.',
    )
  }

  const windows = windowsFor(layer.blocks, deps.windowChars)
  if (windows.length === 0) throw new Error('The precedent has no paragraph text to read.')

  const model = deps.model ?? 'claude-sonnet-5'
  const document = documentBlock(layer)
  const context = {
    route: 'playbooks/extract',
    matterId: null,
    userId: deps.userId ?? null,
    contextType: 'general',
  }

  const perWindow: CandidateRule[][] = windows.map(() => [])
  const failures: ExtractRulesResult['failures'] = []

  const runWindow = async (index: number): Promise<void> => {
    const window = windows[index]
    const request = {
      model,
      max_tokens: 4096,
      system: [
        { type: 'text', text: INSTRUCTIONS },
        // Static prefix, cached; only the assigned range varies per call.
        { type: 'text', text: document, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: windowMessage(window, deps.documentType ?? null) }],
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: EXTRACT_TOOL_NAME },
    } as ModelRequest

    try {
      const input = readToolInput(await deps.callModel(request, context))
      if (!input) {
        failures.push({ window, reason: 'Model returned no tool call' })
        return
      }
      perWindow[index] = candidatesFromInput(input, layer, index, window)
    } catch (error) {
      failures.push({ window, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  // The first window alone, so it writes the cached document the rest read.
  await runWindow(0)
  let next = 1
  const concurrency = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY)
  await Promise.all(
    Array.from({ length: Math.min(concurrency, windows.length - 1) }, async () => {
      while (next < windows.length) {
        const index = next++
        await runWindow(index)
      }
    }),
  )

  failures.sort((a, b) => a.window.firstBlock - b.window.firstBlock)
  return { candidates: dedupeCandidates(perWindow.flat()), windows, failures }
}
