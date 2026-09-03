import type { BoundingBox, Citation, TextLayer } from './types'

/**
 * Turning a model's quote into a verified citation.
 *
 * This function is the product. Everything else in the citation path is
 * plumbing around the question it answers: *is this string actually in this
 * document, exactly once, right here?* A verifier that answers "close enough"
 * is worse than no citations at all, because it manufactures claims that look
 * checkable and are wrong.
 *
 * Two rules follow from that and neither is negotiable:
 *
 * - **The stored quote is the document's text, never the model's.** The model's
 *   string is only ever a search key. What gets persisted is the raw slice at
 *   the offsets found, so `layer.text.slice(charStart, charEnd) === quote`
 *   holds by construction rather than by hope.
 * - **Ambiguity is failure.** A phrase appearing twice in a block produces no
 *   citation at all. Picking the first match would be a coin flip presented as
 *   a fact.
 */

export type VerifyReason = 'ok' | 'empty_quote' | 'not_found' | 'ambiguous' | 'no_text_layer'

export type VerifyScope = 'block' | 'document'

export type VerifyQuoteResult =
  | { ok: true; citation: Citation; scope: VerifyScope }
  | { ok: false; reason: Exclude<VerifyReason, 'ok'>; matches: number }

interface Normalized {
  value: string
  /** `origIdx[i]` is the index in the source string of normalized character `i`. */
  origIdx: number[]
}

/**
 * Folds away the differences that are noise for matching and keeps a map back
 * to raw offsets — the same shape the tracked-changes engine has relied on for
 * a year.
 *
 * Note what is folded and what is not. Whitespace, case, ligatures, typographic
 * quotes and dashes all vary between how a document draws text and how a model
 * repeats it, and none of them changes which words are being cited. Word
 * identity is never touched: no stemming, no synonym folding, no punctuation
 * stripping. A citation that matched only after the punctuation was thrown away
 * would not be a citation.
 *
 * None of this reaches storage. The canonical text is never transformed; this
 * layer exists precisely so that it doesn't have to be.
 */
function normalizeForMatch(raw: string): Normalized {
  const chars: string[] = []
  const origIdx: number[] = []
  let pendingSpace = false
  let started = false

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]

    // Soft hyphens are a line-breaking artifact with no place in a comparison.
    if (ch === '­') continue

    if (/\s/.test(ch)) {
      if (started) pendingSpace = true
      continue
    }

    if (pendingSpace) {
      chars.push(' ')
      origIdx.push(i)
      pendingSpace = false
    }

    let folded = ch
    if (ch === '‘' || ch === '’' || ch === '‛') folded = "'"
    else if (ch === '“' || ch === '”' || ch === '‟') folded = '"'
    else if (ch === '‐' || ch === '‑' || ch === '‒' || ch === '–' || ch === '—' || ch === '−') folded = '-'
    else folded = ch.normalize('NFKC')

    folded = folded.toLowerCase()

    // NFKC can expand one character into several (the "ﬁ" ligature being the
    // case that matters here). Every expanded character maps back to the single
    // source index it came from, so an offset never lands mid-character.
    for (const out of folded) {
      chars.push(out)
      origIdx.push(i)
    }
    started = true
  }

  return { value: chars.join(''), origIdx }
}

function findAll(haystack: string, needle: string, limit: number): number[] {
  const hits: number[] = []
  if (needle.length === 0) return hits
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) break
    hits.push(at)
    if (hits.length >= limit) break
    from = at + 1
  }
  return hits
}

/**
 * Maps a range in normalized space back to raw offsets.
 *
 * The end is the index *after* the last matched character, so it is derived
 * from the last character's source index plus its own length rather than from
 * `origIdx[end]` — which would point at whatever follows, and would quietly
 * swallow the trailing whitespace the normalizer collapsed.
 */
function toRawRange(
  normalized: Normalized,
  start: number,
  length: number,
): { charStart: number; charEnd: number } {
  const charStart = normalized.origIdx[start]
  // Every character a single source character expanded into maps back to that
  // one source index, so ending after it covers the whole of it — including a
  // ligature whose two normalized characters both point here.
  const charEnd = normalized.origIdx[start + length - 1] + 1
  return { charStart, charEnd }
}

export interface PlacedBox {
  page: number
  box: BoundingBox
}

/**
 * The drawing rectangles covering a character range, one per text run it
 * touches, each carrying the page it belongs on.
 *
 * One rectangle per run rather than one union: a citation crossing a line break
 * covers two runs, and a single box around both would shade the empty margin
 * between the lines.
 *
 * The page travels with the rectangle rather than being re-derived by the
 * caller. A caller walking `spans` in parallel to pair pages with boxes would
 * drift the moment a span has no geometry — which is exactly what happens on a
 * rotated page, where offsets stay good and boxes are dropped.
 */
export function bboxesForRange(layer: TextLayer, charStart: number, charEnd: number): PlacedBox[] {
  const placed: PlacedBox[] = []
  for (const span of layer.spans) {
    if (span.charEnd <= charStart || span.charStart >= charEnd) continue
    if (!span.bbox) continue
    const spanLength = span.charEnd - span.charStart
    if (spanLength <= 0) continue

    const from = Math.max(charStart, span.charStart) - span.charStart
    const to = Math.min(charEnd, span.charEnd) - span.charStart
    // Clipping assumes uniform advance width across the run. A run is a single
    // text-drawing operation in one font, so this is close; it is display
    // geometry either way, and the authoritative anchor is the offsets.
    placed.push({
      page: span.page,
      box: {
        x: span.bbox.x + (span.bbox.width * from) / spanLength,
        y: span.bbox.y,
        width: (span.bbox.width * (to - from)) / spanLength,
        height: span.bbox.height,
      },
    })
  }
  return placed
}

function pageForOffset(layer: TextLayer, charStart: number): number | null {
  for (const span of layer.spans) {
    if (charStart >= span.charStart && charStart < span.charEnd) return span.page
  }
  for (const block of layer.blocks) {
    if (charStart >= block.charStart && charStart < block.charEnd) return block.page
  }
  return null
}

function blockIndexForOffset(layer: TextLayer, charStart: number): number {
  for (const block of layer.blocks) {
    if (charStart >= block.charStart && charStart < block.charEnd) return block.index
  }
  return -1
}

function citationAt(layer: TextLayer, charStart: number, charEnd: number): Citation {
  const boxes = bboxesForRange(layer, charStart, charEnd).map(placed => placed.box)
  return {
    blockIndex: blockIndexForOffset(layer, charStart),
    charStart,
    charEnd,
    page: pageForOffset(layer, charStart),
    // One rectangle for the whole span keeps the stored shape simple; the
    // viewer re-derives per-line rectangles with `bboxesForRange` when it draws.
    bbox: boxes.length === 0 ? null : unionOf(boxes),
    quote: layer.text.slice(charStart, charEnd),
    verification: 'verified',
  }
}

function unionOf(boxes: BoundingBox[]): BoundingBox {
  const left = Math.min(...boxes.map(b => b.x))
  const top = Math.min(...boxes.map(b => b.y))
  const right = Math.max(...boxes.map(b => b.x + b.width))
  const bottom = Math.max(...boxes.map(b => b.y + b.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function searchWithin(
  layer: TextLayer,
  quote: string,
  from: number,
  to: number,
): { hits: number[]; resolve: (at: number) => { charStart: number; charEnd: number } } {
  const raw = layer.text.slice(from, to)
  const haystack = normalizeForMatch(raw)
  const needle = normalizeForMatch(quote)
  const hits = findAll(haystack.value, needle.value, 2)
  return {
    hits,
    resolve: at => {
      const range = toRawRange(haystack, at, needle.value.length)
      return { charStart: from + range.charStart, charEnd: from + range.charEnd }
    },
  }
}

/**
 * Locates a model-supplied quote in a text layer and returns a verified
 * citation, or an explicit refusal.
 *
 * `blockIndexHint` scopes the search, which is what makes uniqueness a
 * meaningful test: a boilerplate phrase can appear in five paragraphs of a
 * trust and still be unambiguous inside the one the finding is about. When the
 * hint yields nothing the search widens to the whole document — a wrong hint
 * should not lose a citation that genuinely exists — but the uniqueness rule
 * comes with it, so widening can only ever find a quote that occurs exactly
 * once in the entire instrument.
 */
export function verifyQuote(
  layer: TextLayer,
  quote: string,
  blockIndexHint: number | null,
): VerifyQuoteResult {
  if (layer.status === 'no_text') return { ok: false, reason: 'no_text_layer', matches: 0 }
  if (normalizeForMatch(quote).value.length === 0) {
    return { ok: false, reason: 'empty_quote', matches: 0 }
  }

  const block =
    blockIndexHint === null ? undefined : layer.blocks.find(b => b.index === blockIndexHint)

  if (block) {
    const scoped = searchWithin(layer, quote, block.charStart, block.charEnd)
    if (scoped.hits.length === 1) {
      const range = scoped.resolve(scoped.hits[0])
      return { ok: true, citation: citationAt(layer, range.charStart, range.charEnd), scope: 'block' }
    }
    if (scoped.hits.length > 1) return { ok: false, reason: 'ambiguous', matches: scoped.hits.length }
  }

  const wide = searchWithin(layer, quote, 0, layer.text.length)
  if (wide.hits.length === 1) {
    const range = wide.resolve(wide.hits[0])
    return { ok: true, citation: citationAt(layer, range.charStart, range.charEnd), scope: 'document' }
  }
  if (wide.hits.length > 1) return { ok: false, reason: 'ambiguous', matches: wide.hits.length }
  return { ok: false, reason: 'not_found', matches: 0 }
}
